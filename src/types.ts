// KanDo API Types (for Vibe Kanban integration)

// Default executor constant - used as fallback across the plugin
export const DEFAULT_EXECUTOR = 'CLAUDE_CODE';
export const DEFAULT_EXECUTOR_VARIANTS = ['DEFAULT', 'PLAN', 'APPROVALS'];

// Error formatting utility for consistent error messages
export function formatErrorMessage(context: string, error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return `${context}: ${message}`;
}

export interface VKProject {
	id: string;
	name: string;
	git_repo_path: string;
	setup_script: string | null;
	dev_script: string | null;
	cleanup_script: string | null;
	created_at: string;
	updated_at: string;
}

export interface VKTask {
	id: string;
	project_id: string;
	title: string;
	description: string | null;
	status: VKTaskStatus;
	parent_task_attempt: string | null;
	shared_task_id: string | null;
	created_at: string;
	updated_at: string;
}

export interface VKTaskWithAttemptStatus extends VKTask {
	has_in_progress_attempt: boolean;
	has_merged_attempt: boolean;
	last_attempt_failed: boolean;
	executor: string | null;
}

export type VKTaskStatus = 'notsynced' | 'todo' | 'inprogress' | 'inreview' | 'done' | 'cancelled' | 'deleted';

export interface VKTaskAttempt {
	id: string;
	task_id: string;
	container_ref: string | null;
	branch: string;
	target_branch: string;
	executor: string;
	worktree_deleted: boolean;
	setup_completed_at: string | null;
	created_at: string;
	updated_at: string;
}

export interface VKGitBranch {
	name: string;
	is_current: boolean;
	is_remote: boolean;
}

export interface VKApiResponse<T> {
	success: boolean;
	data?: T;
	message?: string;
}

export interface CreateTaskPayload {
	project_id: string;
	title: string;
	description?: string;
}

export interface UpdateTaskPayload {
	title?: string;
	description?: string;
	status?: VKTaskStatus;
}

export interface CreateTaskAttemptPayload {
	task_id: string;
	executor_profile_id: {
		executor: string;
		variant: string | null;
	};
	base_branch: string;
}

// Plugin Settings
export interface VKPluginSettings {
	vkUrl: string;
	defaultProjectId: string;
	defaultExecutor: string;
	defaultVariant: string;
	defaultBranch: string;
	cardsFolder: string;
	autoPushOnSave: boolean;
	showStatusBar: boolean;
	autoSyncStatus: boolean;
	openInObsidian: boolean;
	debug: boolean;
}

export const DEFAULT_SETTINGS: VKPluginSettings = {
	vkUrl: '',
	defaultProjectId: '',
	defaultExecutor: 'CLAUDE_CODE',
	defaultVariant: 'DEFAULT',
	defaultBranch: 'main',
	cardsFolder: 'Cards',
	autoPushOnSave: false,
	showStatusBar: true,
	autoSyncStatus: true,
	openInObsidian: true,
	debug: false,
};

// Frontmatter fields managed by plugin
export interface VKFrontmatter {
	title?: string;
	vk_project_name?: string;
	vk_project_id?: string;
	vk_task_id?: string;
	vk_status?: VKTaskStatus;
	vk_last_synced?: string;
	vk_attempt_id?: string;
	vk_branch?: string;
	vk_pr_url?: string;
	vk_executor?: string;
}

// Executor Profiles (fetched from API)
export interface VKExecutorProfiles {
	executors: Record<string, Record<string, Record<string, unknown>>>;
}

// Parsed executor profile for UI
export interface VKExecutorOption {
	executor: string;
	variants: string[];
}

// Helper to parse profiles into UI-friendly format
export function parseExecutorProfiles(profiles: VKExecutorProfiles): VKExecutorOption[] {
	const result: VKExecutorOption[] = [];
	for (const [executor, variants] of Object.entries(profiles.executors)) {
		result.push({
			executor,
			variants: Object.keys(variants),
		});
	}
	return result;
}
