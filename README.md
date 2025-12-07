# KanDo

Think. Plan. Do. Think and plan in Obsidian and execute in Vibe Kanban.

An Obsidian plugin that integrates your notes with [Vibe Kanban](https://github.com/BloopAI/vibe-kanban) for AI-powered task execution.

## Example

https://github.com/user-attachments/assets/0876181f-65de-41b5-bc31-e38d96f18c34

## Features

- **Push Cards to Vibe Kanban** - Create tasks in Vibe Kanban directly from your Obsidian notes
- **Execute with AI Agents** - Trigger AI agent execution (Claude Code, etc.) on your tasks
- **Real-time Status Sync** - Automatically sync task status between Obsidian and Vibe Kanban
- **Embedded Dashboard** - View the Vibe Kanban board directly inside Obsidian
- **Toolbar Integration** - Quick action buttons in your editor for common operations

## Requirements

- [Vibe Kanban](https://github.com/BloopAI/vibe-kanban) running locally or on a server
- Obsidian v1.0.0 or higher
- Desktop only (uses Electron webview for embedded dashboard)

## Installation

### Using BRAT (Recommended)

1. Install the [BRAT plugin](https://github.com/TfTHacker/obsidian42-brat) from Community Plugins
2. Open BRAT settings and click "Add Beta plugin"
3. Enter: `mac-tron/kando`
4. Click "Add Plugin" and enable KanDo in Community Plugins

### Manual Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/mac-tron/kando/releases)
2. Create a folder: `.obsidian/plugins/kando/` in your vault
3. Copy the downloaded files into that folder
4. Reload Obsidian
5. Enable the plugin in Settings > Community Plugins

## Setup

1. Open plugin settings (Settings > KanDo)
2. Enter your Vibe Kanban URL (e.g., `http://localhost:5173`)
3. Select your default project
4. Configure your preferred cards folder

## Usage

### Creating Cards

1. Create a new markdown file in your cards folder
2. Click the **+** button in the toolbar, or use the ribbon menu > "New Feature"
3. Fill in the title and optional description
4. The note will be synced with Vibe Kanban

### Executing Cards

1. Open a synced card note
2. Click the **Execute** button in the toolbar
3. Select your AI executor, variant, and base branch
4. The task will start executing in Vibe Kanban

### Monitoring Status

- The status bar shows the current task's status (click to refresh)
- Toolbar buttons update to reflect execution state
- Enable "Auto-sync status" in settings for automatic updates

### Opening in Vibe Kanban

- Click the **External Link** button to open the task in Vibe Kanban
- Use the ribbon menu > "Open Vibe Kanban Board" for the full dashboard

## Settings

| Setting | Description |
|---------|-------------|
| Vibe Kanban URL | URL where Vibe Kanban is running |
| Default Project | Project to use when pushing new cards |
| Default Executor | AI agent to use for task execution |
| Default Variant | Configuration variant for the executor |
| Default Base Branch | Git branch for feature branches |
| Cards Folder | Only sync notes from this folder |
| Auto-push on save | Automatically sync changes when saving |
| Show status bar | Display task status in the status bar |
| Auto-sync status | Automatically poll for status changes |
| Open in Obsidian | Load Vibe Kanban inside Obsidian |

## Frontmatter

KanDo uses YAML frontmatter to track sync status:

```yaml
---
title: My Feature
vk_project_id: abc-123
vk_task_id: def-456
vk_status: inprogress
vk_last_synced: 2024-01-15T10:30:00.000Z
vk_attempt_id: ghi-789
vk_branch: feature/my-feature
---
```

## Commands

| Command | Description |
|---------|-------------|
| Push Card | Push current note to Vibe Kanban |
| Execute Card | Start AI execution on current task |
| Pull Status | Manually refresh task status |
| Open in Vibe Kanban | Open task in Vibe Kanban |
| Create New Card | Create a new card from template |
| Open Vibe Kanban | Open embedded Vibe Kanban dashboard |

## Development

```bash
# Clone the repository
git clone https://github.com/mac-tron/kando.git

# Install dependencies
npm install

# Build for development (with watch)
npm run dev

# Build for production
npm run build
```

## License

MIT License - see [LICENSE](LICENSE) for details.

## Support

- [Report issues](https://github.com/mac-tron/kando/issues)
- [Vibe Kanban Documentation](https://github.com/BloopAI/vibe-kanban)
