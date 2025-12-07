import { ItemView, WorkspaceLeaf, Notice } from 'obsidian';

export const VIBE_KANBAN_VIEW_TYPE = 'vibe-kanban-view';

// Trusted URL patterns for webview security
const TRUSTED_HOSTS = [
	'localhost',
	'127.0.0.1',
	'0.0.0.0',
	'::1',
];

/**
 * Validate if a URL is safe to load in the webview.
 * Only allows localhost/loopback addresses by default.
 * Other URLs require explicit user acknowledgment.
 */
function isUrlTrusted(url: string): { trusted: boolean; host: string } {
	try {
		const parsed = new URL(url);
		const host = parsed.hostname.toLowerCase();
		const trusted = TRUSTED_HOSTS.some(trustedHost =>
			host === trustedHost || host.endsWith(`.${trustedHost}`)
		);
		return { trusted, host };
	} catch {
		return { trusted: false, host: 'invalid' };
	}
}

export interface VibeKanbanViewState extends Record<string, unknown> {
	vkUrl: string;
	path?: string;
}

export class VibeKanbanView extends ItemView {
	private vkUrl: string = '';
	private currentPath: string = '';
	private webview: HTMLElement | null = null;
	private isReady: boolean = false;
	private userAcknowledgedUntrustedUrl: boolean = false;

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
	}

	/**
	 * Set the VK URL and optional path, then load
	 */
	setUrl(vkUrl: string, path: string = ''): void {
		this.vkUrl = vkUrl;
		this.currentPath = path;
		if (this.isReady) {
			this.loadWebview();
		}
	}

	/**
	 * Called by Obsidian when view state is set
	 */
	async setState(state: VibeKanbanViewState, result: { history: boolean }): Promise<void> {
		if (state.vkUrl) {
			this.vkUrl = state.vkUrl;
		}
		if (state.path) {
			this.currentPath = state.path;
		}
		await super.setState(state, result);

		// Load webview after state is set
		if (this.isReady && this.vkUrl) {
			this.loadWebview();
		}
	}

	/**
	 * Get the current view state
	 */
	getState(): Record<string, unknown> {
		return {
			vkUrl: this.vkUrl,
			path: this.currentPath,
		};
	}

	getViewType(): string {
		return VIBE_KANBAN_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'KanDo';
	}

	getIcon(): string {
		return 'kanban';
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass('vk-view-container');

		// Ensure content fills the space
		this.contentEl.style.padding = '0';
		this.contentEl.style.overflow = 'hidden';

		this.isReady = true;

		// If URL is already set (e.g., from setUrl called before onOpen), load now
		if (this.vkUrl) {
			this.loadWebview();
		} else {
			// Show loading message until URL is set via setState
			this.contentEl.createEl('div', {
				cls: 'vk-loading',
				text: 'Loading KanDo...',
			});
		}
	}

	/**
	 * Create and load the webview with the current URL
	 */
	private loadWebview(): void {
		if (!this.vkUrl) return;

		this.contentEl.empty();

		// Validate URL security before loading
		const { trusted, host } = isUrlTrusted(this.vkUrl);
		if (!trusted && !this.userAcknowledgedUntrustedUrl) {
			// Show security warning for non-localhost URLs
			const warningEl = this.contentEl.createDiv({ cls: 'vk-security-warning' });
			warningEl.createEl('h3', { text: 'Security Warning' });
			warningEl.createEl('p', {
				text: `The URL "${host}" is not a localhost address. Loading external content in an embedded webview with disabled security could expose your system to risks.`,
			});
			warningEl.createEl('p', {
				text: 'Only proceed if you trust this URL and understand the risks.',
				cls: 'vk-warning-hint',
			});

			const buttonContainer = warningEl.createDiv({ cls: 'vk-warning-buttons' });
			buttonContainer.createEl('button', { text: 'Cancel' }).addEventListener('click', () => {
				this.leaf.detach();
			});
			buttonContainer.createEl('button', { text: 'Load Anyway', cls: 'mod-warning' }).addEventListener('click', () => {
				this.userAcknowledgedUntrustedUrl = true;
				new Notice('Loading untrusted URL - use caution');
				this.loadWebview();
			});
			return;
		}

		// Build the full URL, handling trailing/leading slashes properly
		const baseUrl = this.vkUrl.replace(/\/+$/, ''); // Remove trailing slashes
		const path = this.currentPath.startsWith('/') ? this.currentPath : `/${this.currentPath}`;
		const fullUrl = this.currentPath ? `${baseUrl}${path}` : baseUrl;

		// Create webview element (Electron webviewTag)
		const webview = document.createElement('webview') as HTMLElement & {
			src: string;
			reload: () => void;
			goBack: () => void;
			goForward: () => void;
			canGoBack: () => boolean;
			canGoForward: () => boolean;
			getURL: () => string;
		};

		// Configure webview with required attributes for proper content loading
		// Based on Obsidian Open Gate plugin's working implementation
		webview.setAttribute('src', fullUrl);
		webview.setAttribute('partition', 'persist:kando');
		// SECURITY NOTE: disablewebsecurity is required for loading local Vibe Kanban instance.
		// URL validation above ensures only trusted (localhost) URLs load without warning.
		// Non-localhost URLs require explicit user acknowledgment.
		webview.setAttribute('disablewebsecurity', 'true');
		webview.setAttribute('allowpopups', 'true');
		webview.classList.add('vk-webview');

		// Style the webview to fill container
		webview.style.width = '100%';
		webview.style.height = '100%';
		webview.style.border = 'none';

		this.webview = webview;
		this.contentEl.appendChild(webview);

		// Workaround for Electron webview sizing bug - trigger resize after DOM ready
		webview.addEventListener('dom-ready', () => {
			// Force a reflow by triggering resize
			window.dispatchEvent(new Event('resize'));
		});

		// Add event listeners for webview
		webview.addEventListener('did-fail-load', (event: Event & { errorCode?: number; errorDescription?: string }) => {
			if (event.errorCode && event.errorCode !== -3) {
				// -3 is aborted load, ignore it
				this.contentEl.empty();
				this.contentEl.createEl('div', {
					cls: 'vk-error',
					text: `Failed to load Vibe Kanban: ${event.errorDescription || 'Unknown error'}`,
				});
				this.contentEl.createEl('div', {
					cls: 'vk-error-hint',
					text: `Make sure Vibe Kanban is running at ${this.vkUrl}`,
				});
			}
		});
	}

	async onClose(): Promise<void> {
		this.webview = null;
		this.isReady = false;
	}

	/**
	 * Navigate to a specific path within VK
	 */
	navigateTo(path: string): void {
		this.currentPath = path;
		if (this.webview && this.vkUrl) {
			const baseUrl = this.vkUrl.replace(/\/+$/, '');
			const normalizedPath = path.startsWith('/') ? path : `/${path}`;
			const fullUrl = `${baseUrl}${normalizedPath}`;
			(this.webview as HTMLElement & { src: string }).src = fullUrl;
		}
	}

	/**
	 * Reload the webview
	 */
	reload(): void {
		if (this.webview) {
			(this.webview as HTMLElement & { reload: () => void }).reload();
		}
	}
}
