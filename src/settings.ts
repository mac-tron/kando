import { App, PluginSettingTab, Setting, Notice, TFolder, setIcon } from 'obsidian';
import type VibeKanbanPlugin from '../main';
import { VKProject, VKExecutorOption, parseExecutorProfiles, DEFAULT_EXECUTOR, DEFAULT_EXECUTOR_VARIANTS } from './types';

export class VKSettingTab extends PluginSettingTab {
	plugin: VibeKanbanPlugin;
	projects: VKProject[] = [];
	executorOptions: VKExecutorOption[] = [];
	private lastConnectionStatus: 'connected' | 'disconnected' | null = null;
	private projectsLoadFailed = false;
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(app: App, plugin: VibeKanbanPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	hide(): void {
		// Clean up debounce timer when settings tab is closed
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}
	}

	async display(): Promise<void> {
		const { containerEl } = this;
		containerEl.empty();

		// Inner wrapper for styling (keeps scrollbar at edge)
		const wrapper = containerEl.createDiv({ cls: 'vk-settings' });

		// Main Header
		wrapper.createEl('h1', { text: 'KanDo', cls: 'vk-main-title' });
		wrapper.createEl('p', { text: 'Think. Plan. Do.', cls: 'vk-tagline' });

		// Load data for dropdowns with error handling
		try {
			await this.loadProjects();
			await this.loadProfiles();
		} catch (error) {
			// Show error but continue rendering with fallback data
			console.error('[KanDo] Error loading settings data:', error);
		}
		const folders = this.getFolders();

		// Store variant dropdown reference for dynamic updates
		let variantDropdownEl: HTMLSelectElement | null = null;

		// === Connection Settings ===
		const connCard = this.createCard(wrapper, 'Connection Settings', 'globe');

		// Connection UI - Single Column / Row
		const connContainer = connCard.createDiv({ cls: 'vk-settings-column' });

		// URL Input
		const urlGroup = connContainer.createDiv({ cls: 'vk-input-group' });
		urlGroup.createDiv({ cls: 'vk-input-label', text: 'Vibe Kanban URL' });
		urlGroup.createDiv({ cls: 'vk-input-description', text: 'The URL where Vibe Kanban is running' });

		// Input Wrapper
		const inputWrapper = urlGroup.createDiv({ cls: 'vk-url-input-wrapper' });
		const urlInput = inputWrapper.createEl('input', {
			cls: 'vk-text-input',
			type: 'text',
			value: this.plugin.settings.vkUrl,
			placeholder: 'http://localhost:5173'
		});

		// Status Icon inside input
		const statusIcon = inputWrapper.createSpan({ cls: 'vk-status-icon-input' });

		// Show current connection status (only after actual test)
		if (this.lastConnectionStatus === 'connected') {
			setIcon(statusIcon, 'check');
			statusIcon.addClass('connected');
		} else if (this.lastConnectionStatus === 'disconnected') {
			setIcon(statusIcon, 'x');
			statusIcon.addClass('disconnected');
		} else if (this.plugin.settings.vkUrl) {
			// Has URL but hasn't been tested yet - test on initial load
			if (!this.projectsLoadFailed && this.projects.length > 0) {
				setIcon(statusIcon, 'check');
				statusIcon.addClass('connected');
				this.lastConnectionStatus = 'connected';
			} else if (this.projectsLoadFailed) {
				setIcon(statusIcon, 'x');
				statusIcon.addClass('disconnected');
				this.lastConnectionStatus = 'disconnected';
			}
			// If no URL or projects not loaded yet, show no icon
		}

		// Debounced auto-test on URL change
		urlInput.addEventListener('input', async () => {
			this.plugin.settings.vkUrl = urlInput.value;
			await this.plugin.saveSettings();
			this.plugin.api.setBaseUrl(urlInput.value);

			// Clear previous timer
			if (this.debounceTimer) {
				clearTimeout(this.debounceTimer);
				this.debounceTimer = null;
			}

			// Show loading state
			statusIcon.empty();
			statusIcon.className = 'vk-status-icon-input';

			if (!urlInput.value) return;

			// Debounce 500ms then test
			this.debounceTimer = setTimeout(async () => {
				setIcon(statusIcon, 'loader-2');
				statusIcon.addClass('loading');

				try {
					await this.plugin.api.getProjects();
					statusIcon.empty();
					statusIcon.className = 'vk-status-icon-input';
					setIcon(statusIcon, 'check');
					statusIcon.addClass('connected');
					this.lastConnectionStatus = 'connected';
					// Refresh to update dropdowns and restart poller with new URL
					await this.plugin.updateWebSocketConnection();
					this.display();
				} catch {
					statusIcon.empty();
					statusIcon.className = 'vk-status-icon-input';
					setIcon(statusIcon, 'x');
					statusIcon.addClass('disconnected');
					this.lastConnectionStatus = 'disconnected';
				}
			}, 500);
		});

		// === Project Defaults ===
		const projCard = this.createCard(wrapper, 'Project Defaults', 'box');
		const projGrid = projCard.createDiv({ cls: 'vk-settings-grid' });

		// Left column - Project & Executor
		const projLeftCol = projGrid.createDiv({ cls: 'vk-settings-column' });
		this.createColumnHeader(projLeftCol, 'Project & Executor');

		this.createDropdownInput(projLeftCol, {
			label: 'Default Project',
			description: 'Project to use when creating new cards',
			options: this.projectsLoadFailed
				? [{ value: '', label: 'Connection failed - check URL' }]
				: this.projects.length === 0
					? [{ value: '', label: 'No projects in Vibe Kanban' }]
					: [
						{ value: '', label: 'Select a project' },
						...this.projects.map((p) => ({ value: p.id, label: p.name })),
					],
			value: this.plugin.settings.defaultProjectId,
			onChange: async (value) => {
				this.plugin.settings.defaultProjectId = value;
				await this.plugin.saveSettings();
			},
		});

		this.createDropdownInput(projLeftCol, {
			label: 'Default Executor',
			description: 'AI agent to execute tasks',
			options:
				this.executorOptions.length === 0
					? [{ value: DEFAULT_EXECUTOR, label: DEFAULT_EXECUTOR.replace(/_/g, ' ') }]
					: this.executorOptions.map((o) => ({
						value: o.executor,
						label: o.executor.replace(/_/g, ' '),
					})),
			value: this.plugin.settings.defaultExecutor,
			onChange: async (value) => {
				this.plugin.settings.defaultExecutor = value;
				await this.plugin.saveSettings();
				this.updateVariantDropdown(variantDropdownEl);
			},
		});

		// Right column - Variant & Branch
		const projRightCol = projGrid.createDiv({ cls: 'vk-settings-column' });
		this.createColumnHeader(projRightCol, 'Variant & Branch');

		const variantContainer = this.createDropdownInput(projRightCol, {
			label: 'Default Variant',
			description: 'Executor mode (e.g., DEFAULT, PLAN)',
			options: [], // Will be populated dynamically
			value: this.plugin.settings.defaultVariant,
			onChange: async (value) => {
				this.plugin.settings.defaultVariant = value;
				await this.plugin.saveSettings();
			},
		});
		variantDropdownEl = variantContainer.querySelector('select');
		this.populateVariantDropdown(variantDropdownEl);

		this.createTextInput(projRightCol, {
			label: 'Default Base Branch',
			description: 'Git branch to use as base for PRs',
			placeholder: 'main',
			value: this.plugin.settings.defaultBranch,
			onChange: async (value) => {
				this.plugin.settings.defaultBranch = value;
				await this.plugin.saveSettings();
			},
		});

		// === Synchronization Settings ===
		const syncCard = this.createCard(wrapper, 'Synchronization', 'refresh-cw');
		const syncGrid = syncCard.createDiv({ cls: 'vk-settings-grid' });

		// Left column - Folders
		const syncLeftCol = syncGrid.createDiv({ cls: 'vk-settings-column' });
		this.createColumnHeader(syncLeftCol, 'Folders');

		this.createFolderInput(syncLeftCol, {
			label: 'Cards Folder',
			description: 'New cards are created here; KanDo actions enabled for files in this folder',
			options: [
				{ value: '', label: 'Select a folder' },
				...folders.map((f) => ({ value: f, label: f })),
			],
			value: this.plugin.settings.cardsFolder,
			onChange: async (value) => {
				this.plugin.settings.cardsFolder = value;
				await this.plugin.saveSettings();
			},
		});

		// Right column - Behavior
		const syncRightCol = syncGrid.createDiv({ cls: 'vk-settings-column' });
		this.createColumnHeader(syncRightCol, 'Behavior');

		this.createToggleSetting(syncRightCol, {
			label: 'Auto-push on save',
			description: 'Push changes to Vibe Kanban when saving files',
			value: this.plugin.settings.autoPushOnSave,
			onChange: async (value) => {
				this.plugin.settings.autoPushOnSave = value;
				await this.plugin.saveSettings();
			},
		});

		this.createToggleSetting(syncRightCol, {
			label: 'Auto-sync status',
			description: 'Sync card status via polling in real-time',
			value: this.plugin.settings.autoSyncStatus,
			onChange: async (value) => {
				this.plugin.settings.autoSyncStatus = value;
				await this.plugin.saveSettings();
				this.plugin.updateWebSocketConnection();
			},
		});

		// === Preferences ===
		const prefCard = this.createCard(wrapper, 'Preferences', 'settings');
		const prefContainer = prefCard.createDiv({ cls: 'vk-settings-column' });

		this.createToggleSetting(prefContainer, {
			label: 'Show status bar',
			description: 'Display connection status in Obsidian status bar',
			value: this.plugin.settings.showStatusBar,
			onChange: async (value) => {
				this.plugin.settings.showStatusBar = value;
				await this.plugin.saveSettings();
				this.plugin.updateStatusBarVisibility();
			},
		});

		this.createToggleSetting(prefContainer, {
			label: 'Open in Obsidian',
			description: 'Open Vibe Kanban natively in Obsidian',
			value: this.plugin.settings.openInObsidian,
			onChange: async (value) => {
				this.plugin.settings.openInObsidian = value;
				await this.plugin.saveSettings();
			},
		});

		// === Advanced ===
		const advCard = this.createCard(wrapper, 'Advanced', 'code');
		const advContainer = advCard.createDiv({ cls: 'vk-settings-column' });

		this.createToggleSetting(advContainer, {
			label: 'Debug mode',
			description: 'Enable verbose logging in developer console',
			value: this.plugin.settings.debug,
			onChange: async (value) => {
				this.plugin.settings.debug = value;
				await this.plugin.saveSettings();
			},
		});
	}

	// === UI Helper Methods ===

	private createCard(parent: HTMLElement, title: string, icon: string): HTMLElement {
		const card = parent.createDiv({ cls: 'vk-card' });
		const header = card.createDiv({ cls: 'vk-card-header' });

		const iconEl = header.createSpan({ cls: 'vk-card-icon' });
		setIcon(iconEl, icon);

		header.createEl('h2', { text: title, cls: 'vk-card-title' });

		return card;
	}

	private createColumnHeader(parent: HTMLElement, title: string, icon?: string): void {
		const header = parent.createDiv({ cls: 'vk-column-header' });
		if (icon) {
			const iconEl = header.createSpan({ cls: 'vk-column-header-icon' });
			setIcon(iconEl, icon);
		}
		header.createSpan({ text: title });
	}

	private createTextInput(
		parent: HTMLElement,
		config: {
			label: string;
			description: string;
			placeholder: string;
			value: string;
			onChange: (value: string) => void;
		}
	): HTMLElement {
		const container = parent.createDiv({ cls: 'vk-input-group' });

		// Create label element with proper accessibility association
		const labelId = `vk-label-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
		const labelEl = container.createEl('label', { text: config.label, cls: 'vk-input-label' });
		labelEl.setAttribute('id', labelId);

		container.createEl('div', { text: config.description, cls: 'vk-input-description' });

		const input = container.createEl('input', {
			cls: 'vk-text-input',
			type: 'text',
			placeholder: config.placeholder,
			value: config.value,
		});
		input.setAttribute('aria-labelledby', labelId);
		input.addEventListener('input', () => config.onChange(input.value));

		return container;
	}

	private createDropdownInput(
		parent: HTMLElement,
		config: {
			label: string;
			description: string;
			options: { value: string; label: string }[];
			value: string;
			onChange: (value: string) => void;
		}
	): HTMLElement {
		const container = parent.createDiv({ cls: 'vk-input-group' });

		// Create label element with proper accessibility association
		const labelId = `vk-label-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
		const labelEl = container.createEl('label', { text: config.label, cls: 'vk-input-label' });
		labelEl.setAttribute('id', labelId);

		container.createEl('div', { text: config.description, cls: 'vk-input-description' });

		const select = container.createEl('select', { cls: 'vk-dropdown' });
		select.setAttribute('aria-labelledby', labelId);
		for (const option of config.options) {
			const opt = select.createEl('option', { value: option.value, text: option.label });
			if (option.value === config.value) opt.selected = true;
		}
		select.addEventListener('change', () => config.onChange(select.value));

		return container;
	}

	private createFolderInput(
		parent: HTMLElement,
		config: {
			label: string;
			description: string;
			options: { value: string; label: string }[];
			value: string;
			onChange: (value: string) => void;
		}
	): HTMLElement {
		// Use standard dropdown - no need for separate folder button
		return this.createDropdownInput(parent, config);
	}

	private createToggleSetting(
		parent: HTMLElement,
		config: {
			label: string;
			description: string;
			value: boolean;
			onChange: (value: boolean) => void;
		}
	): HTMLElement {
		const container = parent.createDiv({ cls: 'vk-toggle-item' });

		// Create unique ID for accessibility
		const inputId = `vk-toggle-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

		// Toggle Switch
		const switchEl = container.createDiv({ cls: 'vk-toggle-switch' });
		const input = switchEl.createEl('input', { type: 'checkbox', cls: 'vk-toggle-input' });
		input.checked = config.value;
		input.setAttribute('id', inputId);
		input.setAttribute('aria-describedby', `${inputId}-desc`);

		const slider = switchEl.createDiv({ cls: 'vk-toggle-slider' });
		slider.setAttribute('role', 'presentation');
		slider.setAttribute('tabindex', '0');

		// Handle click on slider
		slider.addEventListener('click', () => {
			input.checked = !input.checked;
			config.onChange(input.checked);
		});

		// Handle keyboard on slider (Space/Enter to toggle)
		slider.addEventListener('keydown', (e) => {
			if (e.key === ' ' || e.key === 'Enter') {
				e.preventDefault();
				input.checked = !input.checked;
				config.onChange(input.checked);
			}
		});

		// Content
		const content = container.createDiv({ cls: 'vk-toggle-content' });
		const labelEl = content.createEl('label', { text: config.label, cls: 'vk-toggle-label' });
		labelEl.setAttribute('for', inputId);
		const descEl = content.createDiv({ text: config.description, cls: 'vk-toggle-desc' });
		descEl.setAttribute('id', `${inputId}-desc`);

		return container;
	}

	private async loadProjects(): Promise<void> {
		try {
			this.projects = await this.plugin.api.getProjects();
			this.projectsLoadFailed = false;
		} catch {
			this.projects = [];
			this.projectsLoadFailed = true;
		}
	}

	private async loadProfiles(): Promise<void> {
		try {
			const profiles = await this.plugin.api.getProfiles();
			this.executorOptions = parseExecutorProfiles(profiles);
		} catch {
			// Fallback to default using constants
			this.executorOptions = [
				{ executor: DEFAULT_EXECUTOR, variants: [...DEFAULT_EXECUTOR_VARIANTS] },
			];
		}
	}

	private populateVariantDropdown(selectEl: HTMLSelectElement | null): void {
		if (!selectEl) return;

		// Clear existing options
		selectEl.empty();

		// Find the current executor's variants
		const executorOption = this.executorOptions.find(
			(opt) => opt.executor === this.plugin.settings.defaultExecutor
		);

		const variants = executorOption?.variants || ['DEFAULT'];

		for (const variant of variants) {
			const option = selectEl.createEl('option', {
				text: variant,
				value: variant,
			});
			if (variant === this.plugin.settings.defaultVariant) {
				option.selected = true;
			}
		}

		// If current variant not available, reset to DEFAULT or first
		if (!variants.includes(this.plugin.settings.defaultVariant)) {
			this.plugin.settings.defaultVariant = variants.includes('DEFAULT')
				? 'DEFAULT'
				: variants[0] || 'DEFAULT';
			selectEl.value = this.plugin.settings.defaultVariant;
		}
	}

	private updateVariantDropdown(selectEl: HTMLSelectElement | null): void {
		this.populateVariantDropdown(selectEl);
	}

	private getFolders(): string[] {
		const folders: string[] = [];
		const allFiles = this.app.vault.getAllLoadedFiles();

		for (const file of allFiles) {
			if (file instanceof TFolder && file.path !== '/') {
				folders.push(file.path);
			}
		}

		// Sort alphabetically for easier navigation
		return folders.sort((a, b) => a.localeCompare(b));
	}

}
