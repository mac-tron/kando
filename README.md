# KanDo

Think. Plan. Do. Think and plan in Obsidian and execute in Vibe Kanban.

An Obsidian plugin that integrates your notes with [Vibe Kanban](https://github.com/BloopAI/vibe-kanban) for AI-powered task execution.

## Features

- **Push Stories to Vibe Kanban** - Create tasks in Vibe Kanban directly from your Obsidian notes
- **Execute with AI Agents** - Trigger AI agent execution (Claude Code, etc.) on your tasks
- **Real-time Status Sync** - Automatically sync task status between Obsidian and Vibe Kanban
- **Embedded Dashboard** - View the Vibe Kanban board directly inside Obsidian
- **Toolbar Integration** - Quick action buttons in your editor for common operations

## Requirements

- [Vibe Kanban](https://github.com/BloopAI/vibe-kanban) running locally or on a server
- Obsidian v1.0.0 or higher
- Desktop only (uses Electron webview for embedded dashboard)

## Installation

### From Community Plugins (Coming Soon)

1. Open Obsidian Settings
2. Go to Community Plugins and disable Safe Mode
3. Click Browse and search for "KanDo"
4. Install and enable the plugin

### Manual Installation

1. Download the latest release from the [releases page](https://github.com/mac-tron/obsidian-kando/releases)
2. Extract the files into your vault's `.obsidian/plugins/kando/` folder
3. Reload Obsidian
4. Enable the plugin in Settings > Community Plugins

## Setup

1. Open plugin settings (Settings > KanDo)
2. Enter your Vibe Kanban URL (e.g., `http://localhost:5173`)
3. Click "Test" to verify the connection
4. Select your default project
5. Configure your preferred stories folder

## Usage

### Creating Stories

1. Create a new markdown file in your stories folder
2. Click the **+** button in the toolbar, or use the ribbon menu > "New Feature"
3. Fill in the title and optional description
4. The note will be synced with Vibe Kanban

### Executing Stories

1. Open a synced story note
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
| Default Project | Project to use when pushing new stories |
| Default Executor | AI agent to use for task execution |
| Default Variant | Configuration variant for the executor |
| Default Base Branch | Git branch for feature branches |
| Stories Folder | Only sync notes from this folder |
| Story Creation Folder | Where new stories are created |
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
| Push Story | Push current note to Vibe Kanban |
| Execute Story | Start AI execution on current task |
| Pull Status | Manually refresh task status |
| Open in Vibe Kanban | Open task in Vibe Kanban |
| Create New Story | Create a new story from template |
| Open Vibe Kanban | Open embedded Vibe Kanban dashboard |

## Development

```bash
# Clone the repository
git clone https://github.com/mac-tron/obsidian-kando.git

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

- [Report issues](https://github.com/mac-tron/obsidian-kando/issues)
- [Vibe Kanban Documentation](https://github.com/BloopAI/vibe-kanban)
