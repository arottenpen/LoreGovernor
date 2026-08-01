import { eventSource, event_types } from '../../../../script.js';
import { getContext } from '../../../extensions.js';
import { world_names, loadWorldInfo, updateWorldInfoList } from '../../../world-info.js';
import { POPUP_TYPE } from '../../../popup.js';

const MODULE_NAME = 'lore_governor';
const CHAT_METADATA_KEY = 'lore_governor';

const BUCKET_ALWAYS_ON = 'always_on';
const BUCKET_ALWAYS_OFF = 'always_off';
const BUCKET_UNMANAGED = 'unmanaged';
const BUCKET_LABELS = {
    [BUCKET_ALWAYS_ON]: 'Always On',
    [BUCKET_ALWAYS_OFF]: 'Always Off',
    [BUCKET_UNMANAGED]: 'Unmanaged',
};

function defaultSettings() {
    return {
        entryBooks: [],  // [{ name: string, groups: [{id, name, description, mode: 'one'|'any'}], assignments: {uid: bucket} }]
        toggleBooks: [], // [string]
    };
}

function getSettings() {
    const context = getContext();
    if (!context.extensionSettings[MODULE_NAME]) {
        context.extensionSettings[MODULE_NAME] = defaultSettings();
    }
    const settings = context.extensionSettings[MODULE_NAME];
    if (!Array.isArray(settings.entryBooks)) settings.entryBooks = [];
    if (!Array.isArray(settings.toggleBooks)) settings.toggleBooks = [];

    for (const bookCfg of settings.entryBooks) {
        if (!Array.isArray(bookCfg.groups)) bookCfg.groups = [];
        if (!bookCfg.assignments || typeof bookCfg.assignments !== 'object') bookCfg.assignments = {};
        // Legacy format migration: "exceptions" entries were left alone, same as the new default Unmanaged bucket.
        if (Array.isArray(bookCfg.exceptions)) delete bookCfg.exceptions;
    }

    return settings;
}

function saveSettings() {
    getContext().saveSettingsDebounced();
}

function hasGovernedBooks() {
    const settings = getSettings();
    return settings.entryBooks.length > 0 || settings.toggleBooks.length > 0;
}

function getBucket(bookCfg, uid) {
    return bookCfg.assignments[uid] ?? BUCKET_UNMANAGED;
}

function bucketLabel(bookCfg, bucket) {
    if (BUCKET_LABELS[bucket]) return BUCKET_LABELS[bucket];
    return bookCfg.groups.find(g => g.id === bucket)?.name ?? 'Unmanaged';
}

function getChatSelection() {
    const context = getContext();
    return context.chatMetadata?.[CHAT_METADATA_KEY] ?? null;
}

function saveChatSelection(selection) {
    const context = getContext();
    context.updateChatMetadata({ [CHAT_METADATA_KEY]: selection }, false);
    context.saveMetadataDebounced();
}

async function getBookEntries(bookName) {
    const data = await loadWorldInfo(bookName);
    if (!data || !data.entries) return [];
    return Object.values(data.entries).sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
}

function entryLabel(entry) {
    if (entry.comment) return entry.comment;
    if (Array.isArray(entry.key) && entry.key.length) return entry.key.join(', ');
    return `Entry ${entry.uid}`;
}

/**
 * Applies this chat's saved lore selection to freshly loaded WI entries, in memory only.
 * Never touches the underlying lorebook file.
 */
function onWorldInfoEntriesLoaded(payload) {
    if (!hasGovernedBooks()) return;

    const settings = getSettings();
    const selection = getChatSelection();
    const allEntries = [
        ...(payload?.globalLore || []),
        ...(payload?.characterLore || []),
        ...(payload?.chatLore || []),
        ...(payload?.personaLore || []),
    ];

    for (const entry of allEntries) {
        const bookName = entry.world;
        const uid = String(entry.uid);

        const bookCfg = settings.entryBooks.find(b => b.name === bookName);
        if (bookCfg) {
            const bucket = getBucket(bookCfg, uid);
            if (bucket === BUCKET_UNMANAGED) continue; // left alone, whatever the book file says
            if (bucket === BUCKET_ALWAYS_ON) { entry.disable = false; continue; }
            if (bucket === BUCKET_ALWAYS_OFF) { entry.disable = true; continue; }
            // Custom group: bucket is the group id.
            const selectedUids = selection?.groups?.[bookName]?.[bucket] ?? [];
            entry.disable = !selectedUids.includes(uid);
            continue;
        }

        if (settings.toggleBooks.includes(bookName)) {
            const toggleState = selection?.toggles?.[bookName];
            const isEnabled = toggleState !== false; // default on when unset
            if (!isEnabled) entry.disable = true;
        }
    }
}

/**
 * Builds and shows the per-chat picker popup, grouped by each book's custom groups.
 * Pre-selects from the existing saved selection, if any.
 */
async function openLorePicker() {
    const settings = getSettings();
    if (!hasGovernedBooks()) {
        toastr.info('No lorebooks are configured for governance yet. Set some up in the Lore Governor extension settings.');
        return;
    }

    const existing = getChatSelection();
    const pending = {
        groups: structuredClone(existing?.groups ?? {}),
        toggles: structuredClone(existing?.toggles ?? {}),
    };

    const $container = $('<div class="lore-governor-popup"></div>');

    for (const bookCfg of settings.entryBooks) {
        if (!bookCfg.groups.length) continue;
        const entries = await getBookEntries(bookCfg.name);
        if (!pending.groups[bookCfg.name]) pending.groups[bookCfg.name] = {};

        const sortedGroups = [...bookCfg.groups].sort((a, b) => a.name.localeCompare(b.name));

        for (const group of sortedGroups) {
            const members = entries.filter(e => getBucket(bookCfg, String(e.uid)) === group.id);
            if (!members.length) continue;

            const $section = $('<div class="lore-governor-section"></div>');
            $section.append(`<h4>${DOMPurify.sanitize(bookCfg.name)} — ${DOMPurify.sanitize(group.name)}</h4>`);
            if (group.description) {
                $section.append(`<div class="lore-governor-group-desc">${DOMPurify.sanitize(group.description)}</div>`);
            }

            const selectedUids = pending.groups[bookCfg.name][group.id] ?? [];

            if (group.mode === 'one') {
                const $select = $('<select class="text_pole lore-governor-group-select"></select>');
                $select.append('<option value="">-- none --</option>');
                for (const entry of members) {
                    const uid = String(entry.uid);
                    const $opt = $(`<option value="${uid}"></option>`).text(entryLabel(entry));
                    if (selectedUids.includes(uid)) $opt.prop('selected', true);
                    $select.append($opt);
                }

                $select.on('change', function () {
                    const val = $(this).val();
                    pending.groups[bookCfg.name][group.id] = val ? [val] : [];
                });

                $section.append($select);
            } else {
                const $list = $('<div class="lore-governor-entry-list lore-governor-checkbox-list"></div>');
                for (const entry of members) {
                    const uid = String(entry.uid);
                    const checked = selectedUids.includes(uid);
                    const id = `lg-entry-${bookCfg.name}-${group.id}-${uid}`.replace(/[^a-zA-Z0-9_-]/g, '_');
                    const $label = $(`<label class="checkbox_label" for="${id}"></label>`);
                    const $checkbox = $(`<input type="checkbox" id="${id}">`).prop('checked', checked);
                    $label.append($checkbox).append(`<span>${DOMPurify.sanitize(entryLabel(entry))}</span>`);

                    $checkbox.on('change', function () {
                        const isChecked = $(this).prop('checked');
                        if (!pending.groups[bookCfg.name][group.id]) pending.groups[bookCfg.name][group.id] = [];
                        const arr = pending.groups[bookCfg.name][group.id];
                        const idx = arr.indexOf(uid);
                        if (isChecked && idx === -1) arr.push(uid);
                        if (!isChecked && idx !== -1) arr.splice(idx, 1);
                    });

                    $list.append($label);
                }
                $section.append($list);
            }

            $container.append($section);
        }
    }

    if (settings.toggleBooks.length) {
        const $section = $('<div class="lore-governor-section"><h4>Lorebooks</h4></div>');
        const $list = $('<div class="lore-governor-entry-list"></div>');

        for (const bookName of settings.toggleBooks) {
            const checked = (pending.toggles[bookName] ?? true) !== false;
            const id = `lg-toggle-${bookName}`.replace(/[^a-zA-Z0-9_-]/g, '_');
            const $label = $(`<label class="checkbox_label" for="${id}"></label>`);
            const $checkbox = $(`<input type="checkbox" id="${id}">`).prop('checked', checked);
            $label.append($checkbox).append(`<span>${DOMPurify.sanitize(bookName)}</span>`);

            $checkbox.on('change', function () {
                pending.toggles[bookName] = $(this).prop('checked');
            });

            $list.append($label);
        }

        $section.append($list);
        $container.append($section);
    }

    if (!$container.children().length) {
        toastr.info('Nothing to pick yet: configure some groups (with entries assigned to them) or toggle-books in the Lore Governor settings.');
        return;
    }

    const context = getContext();
    await context.callGenericPopup($container, POPUP_TYPE.TEXT, '', {
        wide: true,
        large: false,
        okButton: 'Save',
        cancelButton: false,
        allowVerticalScrolling: true,
    });

    saveChatSelection(pending);
    toastr.success('Lore selection saved for this chat.');
}

function onChatCreated() {
    if (!hasGovernedBooks()) return;
    // Give the new chat a moment to finish initializing before we prompt.
    setTimeout(() => openLorePicker(), 200);
}

async function renderSettings() {
    await updateWorldInfoList();
    const settings = getSettings();

    const $drawer = $(`
        <div class="lore-governor-settings inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Lore Governor</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <div class="lore-governor-block">
                    <h4>Entry-governed lorebooks</h4>
                    <small>Create groups per lorebook, assign entries to them, then pick per-chat which are active. Entries left Unmanaged are never touched.</small>
                    <div class="lore-governor-row">
                        <select class="lore-governor-add-entry-book text_pole"></select>
                        <button class="menu_button lore-governor-add-entry-book-btn">Add</button>
                    </div>
                    <div class="lore-governor-entry-books-list"></div>
                </div>
                <hr>
                <div class="lore-governor-block">
                    <h4>Toggle-governed lorebooks</h4>
                    <small>Pick which whole lorebooks are on/off per-chat, no entry-level detail.</small>
                    <div class="lore-governor-row">
                        <select class="lore-governor-add-toggle-book text_pole"></select>
                        <button class="menu_button lore-governor-add-toggle-book-btn">Add</button>
                    </div>
                    <div class="lore-governor-toggle-books-list"></div>
                </div>
                <hr>
                <div class="lore-governor-block">
                    <button class="menu_button lore-governor-open-picker-btn">
                        <i class="fa-solid fa-book-open"></i> Configure lore for current chat
                    </button>
                </div>
            </div>
        </div>
    `);

    function populateBookSelect($select, excludeNames) {
        $select.empty().append('<option value="">-- select a lorebook --</option>');
        for (const name of world_names) {
            if (excludeNames.includes(name)) continue;
            $select.append(`<option value="${DOMPurify.sanitize(name)}">${DOMPurify.sanitize(name)}</option>`);
        }
    }

    // world_names is a snapshot; lorebooks created elsewhere after this drawer first rendered
    // won't appear until we re-fetch. Refresh right before either dropdown is opened.
    async function refreshBookSelects() {
        await updateWorldInfoList();
        populateBookSelect($drawer.find('.lore-governor-add-entry-book'), settings.entryBooks.map(b => b.name));
        populateBookSelect($drawer.find('.lore-governor-add-toggle-book'), settings.toggleBooks);
    }

    function renderEntryBooksList() {
        const $list = $drawer.find('.lore-governor-entry-books-list').empty();
        for (const bookCfg of settings.entryBooks) {
            const $row = $(`
                <div class="lore-governor-book-row">
                    <span class="lore-governor-book-name">${DOMPurify.sanitize(bookCfg.name)}</span>
                    <button class="menu_button lore-governor-groups-btn" data-book="${DOMPurify.sanitize(bookCfg.name)}">Groups (${bookCfg.groups.length})</button>
                    <button class="menu_button lore-governor-remove-entry-book-btn" data-book="${DOMPurify.sanitize(bookCfg.name)}"><i class="fa-solid fa-trash"></i></button>
                </div>
            `);
            $list.append($row);
        }
        populateBookSelect($drawer.find('.lore-governor-add-entry-book'), settings.entryBooks.map(b => b.name));
    }

    function renderToggleBooksList() {
        const $list = $drawer.find('.lore-governor-toggle-books-list').empty();
        for (const name of settings.toggleBooks) {
            const $row = $(`
                <div class="lore-governor-book-row">
                    <span class="lore-governor-book-name">${DOMPurify.sanitize(name)}</span>
                    <button class="menu_button lore-governor-remove-toggle-book-btn" data-book="${DOMPurify.sanitize(name)}"><i class="fa-solid fa-trash"></i></button>
                </div>
            `);
            $list.append($row);
        }
        populateBookSelect($drawer.find('.lore-governor-add-toggle-book'), settings.toggleBooks);
    }

    $drawer.on('mousedown', '.lore-governor-add-entry-book, .lore-governor-add-toggle-book', () => refreshBookSelects());

    $drawer.on('click', '.lore-governor-add-entry-book-btn', () => {
        const name = $drawer.find('.lore-governor-add-entry-book').val();
        if (!name) return;
        settings.entryBooks.push({ name, groups: [], assignments: {} });
        saveSettings();
        renderEntryBooksList();
    });

    $drawer.on('click', '.lore-governor-remove-entry-book-btn', function () {
        const name = $(this).data('book');
        settings.entryBooks = settings.entryBooks.filter(b => b.name !== name);
        saveSettings();
        renderEntryBooksList();
    });

    $drawer.on('click', '.lore-governor-add-toggle-book-btn', () => {
        const name = $drawer.find('.lore-governor-add-toggle-book').val();
        if (!name) return;
        settings.toggleBooks.push(name);
        saveSettings();
        renderToggleBooksList();
    });

    $drawer.on('click', '.lore-governor-remove-toggle-book-btn', function () {
        const name = $(this).data('book');
        settings.toggleBooks = settings.toggleBooks.filter(b => b !== name);
        saveSettings();
        renderToggleBooksList();
    });

    $drawer.on('click', '.lore-governor-groups-btn', async function () {
        const bookName = $(this).data('book');
        const bookCfg = settings.entryBooks.find(b => b.name === bookName);
        if (!bookCfg) return;

        const entries = await getBookEntries(bookName);
        const context = getContext();

        const $container = $('<div class="lore-governor-popup lore-governor-groups-manager"></div>');

        const $groupsBlock = $('<div class="lore-governor-block"></div>');
        $groupsBlock.append('<h4>Groups</h4>');
        $groupsBlock.append('<small>Always On, Always Off, and Unmanaged are built-in. Create custom groups below for entries you want the per-chat picker to ask about.</small>');
        const $groupsList = $('<div class="lore-governor-groups-list"></div>');
        $groupsBlock.append($groupsList);
        $groupsBlock.append(`
            <div class="lore-governor-row lore-governor-add-group-row">
                <input type="text" class="text_pole lore-governor-new-group-name" placeholder="Group name">
                <select class="text_pole lore-governor-new-group-mode">
                    <option value="any">Select any</option>
                    <option value="one">Select one</option>
                </select>
                <button class="menu_button lore-governor-add-group-btn">Add Group</button>
            </div>
            <textarea class="text_pole lore-governor-new-group-desc" placeholder="Optional description shown when picking (e.g. &quot;Pick your character's homeland&quot;)" rows="1"></textarea>
        `);
        $container.append($groupsBlock);
        $container.append('<hr>');

        const $entriesBlock = $('<div class="lore-governor-block"></div>');
        $entriesBlock.append('<h4>Entries</h4>');
        const $entriesList = $('<div class="lore-governor-entries-assign-list"></div>');
        $entriesBlock.append($entriesList);
        $container.append($entriesBlock);

        function bucketOptionsHtml(selectedBucket) {
            const options = [
                [BUCKET_ALWAYS_ON, 'Always On'],
                [BUCKET_ALWAYS_OFF, 'Always Off'],
                [BUCKET_UNMANAGED, 'Unmanaged'],
                ...bookCfg.groups.map(g => [g.id, g.name]),
            ];
            return options.map(([value, label]) =>
                `<option value="${value}"${value === selectedBucket ? ' selected' : ''}>${DOMPurify.sanitize(label)}</option>`,
            ).join('');
        }

        function renderGroupsList() {
            $groupsList.empty();
            if (!bookCfg.groups.length) {
                $groupsList.append('<div class="lore-governor-empty">No custom groups yet.</div>');
                return;
            }
            for (const group of bookCfg.groups) {
                const memberCount = entries.filter(e => getBucket(bookCfg, String(e.uid)) === group.id).length;
                const $row = $(`
                    <div class="lore-governor-book-row">
                        <span class="lore-governor-book-name">${DOMPurify.sanitize(group.name)} <small>(${group.mode === 'one' ? 'select one' : 'select any'}, ${memberCount} ${memberCount === 1 ? 'entry' : 'entries'})</small></span>
                        <button class="menu_button lore-governor-remove-group-btn" data-group="${group.id}"><i class="fa-solid fa-trash"></i></button>
                    </div>
                    ${group.description ? `<div class="lore-governor-group-desc">${DOMPurify.sanitize(group.description)}</div>` : ''}
                `);
                $groupsList.append($row);
            }
        }

        function renderEntriesList() {
            $entriesList.empty();
            for (const entry of entries) {
                const uid = String(entry.uid);
                const bucket = getBucket(bookCfg, uid);
                const $row = $(`
                    <div class="lore-governor-entry-assign-row">
                        <span>${DOMPurify.sanitize(entryLabel(entry))}</span>
                        <select class="text_pole lore-governor-assign-select" data-uid="${uid}">
                            ${bucketOptionsHtml(bucket)}
                        </select>
                    </div>
                `);
                $entriesList.append($row);
            }
        }

        $container.on('click', '.lore-governor-add-group-btn', () => {
            const name = $container.find('.lore-governor-new-group-name').val().trim();
            if (!name) return;
            const mode = $container.find('.lore-governor-new-group-mode').val();
            const description = $container.find('.lore-governor-new-group-desc').val().trim();
            bookCfg.groups.push({ id: context.uuidv4(), name, mode, description });
            $container.find('.lore-governor-new-group-name').val('');
            $container.find('.lore-governor-new-group-desc').val('');
            renderGroupsList();
            renderEntriesList();
        });

        $container.on('click', '.lore-governor-remove-group-btn', function () {
            const groupId = $(this).data('group');
            bookCfg.groups = bookCfg.groups.filter(g => g.id !== groupId);
            for (const uid of Object.keys(bookCfg.assignments)) {
                if (bookCfg.assignments[uid] === groupId) delete bookCfg.assignments[uid];
            }
            renderGroupsList();
            renderEntriesList();
        });

        $container.on('change', '.lore-governor-assign-select', function () {
            const uid = String($(this).data('uid'));
            const bucket = $(this).val();
            if (bucket === BUCKET_UNMANAGED) {
                delete bookCfg.assignments[uid];
            } else {
                bookCfg.assignments[uid] = bucket;
            }
            renderGroupsList();
        });

        renderGroupsList();
        renderEntriesList();

        await context.callGenericPopup($container, POPUP_TYPE.TEXT, '', {
            okButton: 'Done',
            cancelButton: false,
            wide: true,
            allowVerticalScrolling: true,
        });

        saveSettings();
        renderEntryBooksList();
    });

    $drawer.on('click', '.lore-governor-open-picker-btn', () => openLorePicker());

    renderEntryBooksList();
    renderToggleBooksList();

    $('#extensions_settings2').append($drawer);
}

jQuery(async () => {
    await renderSettings();

    eventSource.on(event_types.WORLDINFO_ENTRIES_LOADED, onWorldInfoEntriesLoaded);
    eventSource.on(event_types.CHAT_CREATED, onChatCreated);
    eventSource.on(event_types.GROUP_CHAT_CREATED, onChatCreated);

    const context = getContext();
    context.SlashCommandParser.addCommandObject(context.SlashCommand.fromProps({
        name: 'loregovernor',
        callback: async () => {
            await openLorePicker();
            return '';
        },
        helpString: 'Opens the Lore Governor entry/lorebook picker for the current chat.',
    }));
});
