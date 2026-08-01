# Lore Governor

A [SillyTavern](https://github.com/SillyTavern/SillyTavern) extension that lets you use a lorebook (World Info) as a set of per-chat parameters, instead of manually enabling/disabling entries every time you switch chats.

You keep a single shared lorebook. This extension decides, per chat, which entries actually fire — without ever editing the lorebook file itself.

## The problem this solves

If you use a lorebook as a bank of options (regions, factions, character backgrounds, settings, etc.) and manually toggle entries on/off per chat, it gets tedious fast — and coming back to an old chat means guessing what you had enabled from context clues.

Lore Governor lets you define **groups** of entries in a lorebook, and shows you a picker when you start a new chat. Your choice is remembered per chat and re-applied automatically every time you open it — no manual toggling, and the lorebook file on disk is never modified.

## How it works

Entries are filtered at generation time (the same moment SillyTavern decides which World Info entries are active for the current prompt), purely in memory. Two different chats using the same lorebook can have completely different entries active simultaneously, with no risk of one chat's settings clobbering another's.

## Features

- **Per-entry groups**, scoped to a specific lorebook. Every entry belongs to exactly one bucket:
  - **Always On** — forced active in every chat, no picker involved (e.g. core lore that makes the book work).
  - **Always Off** — forced inactive in every chat (shelve something without deleting it).
  - **Unmanaged** — left completely alone, exactly as authored in the book. The default for anything you haven't sorted into a group.
  - **Custom groups** — entries you want the picker to ask about per chat. Each group has a name, an optional description, and a mode:
    - *Select one* — a dropdown, only one entry from the group can be active at a time.
    - *Select any* — a scrollable/resizable checkbox list, any subset can be active.
- **Whole-lorebook toggles** — separately, pick entire lorebooks to be turned on/off per chat with no entry-level detail.
- **Automatic prompt on new chats** — the picker pops up once when you start a brand-new chat with a character. Switching between existing chats doesn't re-prompt.
- **Manual reconfigure** — reopen the picker for the current chat any time via the settings panel button or the `/loregovernor` slash command.
- **Never touches the lorebook file** — governance is applied in memory at generation time; the underlying World Info file's `disable` flags are never written to.

## Installation

**Via SillyTavern's extension installer (recommended):**

1. Open the **Extensions** panel (puzzle piece icon) → **Install Extension**.
2. Paste this repo's URL: `https://github.com/ZeadenBeake/SillyTavern-LoreGovernor`
3. Install for yourself, or globally if you're an admin on a shared instance.

**Manual install:**

Clone this repo into `public/scripts/extensions/third-party/SillyTavern-LoreGovernor` inside your SillyTavern install, then reload the page.

## Usage

### 1. Set up a lorebook

Open **Extensions → Lore Governor**.

- Under **Entry-governed lorebooks**, add a lorebook you want per-entry control over.
- Under **Toggle-governed lorebooks**, add any lorebooks you just want to flip on/off as a whole per chat.

### 2. Create groups and sort entries

Click **Groups** on an entry-governed lorebook. From there:

- Add a custom group: give it a name, pick *Select one* or *Select any*, and optionally a description (shown to you when picking, e.g. "Pick your character's homeland").
- In the **Entries** list, assign each entry to a bucket: Always On, Always Off, Unmanaged, or one of your custom groups.

### 3. Pick per chat

Start a new chat with a character that uses a governed lorebook — the picker pops up automatically, grouped by lorebook and group name. Your choices are saved to that chat and re-applied every time you reopen it.

To change a chat's selection later, use the **Configure lore for current chat** button in the settings panel, or run `/loregovernor`.

## License

MIT — see [LICENSE](LICENSE).
