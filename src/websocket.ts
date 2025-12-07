import { requestUrl } from 'obsidian';
import { VKTaskWithAttemptStatus } from './types';

export type TaskUpdateCallback = (task: VKTaskWithAttemptStatus) => void;

/**
 * Polls VK for task status changes.
 * SSE/WebSocket don't work from Obsidian due to CORS restrictions,
 * so we use polling with Obsidian's requestUrl which bypasses CORS.
 */
export class VKStatusPoller {
	private pollTimer: number | null = null;
	private pollInterval = 5000; // 5 seconds
	private baseBackoff = 5000; // Base backoff for errors
	private maxBackoff = 60000; // Max backoff (1 minute)
	private currentBackoff = 5000;
	private consecutiveErrors = 0;
	private isPolling = false;
	private onTaskUpdate: TaskUpdateCallback | null = null;
	private vkUrl: string = '';
	private projectIds: Set<string> = new Set();
	private lastKnownStates: Map<string, string> = new Map(); // taskId -> "status:executing" combined state
	private taskProjectMap: Map<string, string> = new Map(); // taskId -> projectId (for cleanup)
	private debug: boolean = false;
	private maxTrackedTasks = 1000; // Prevent unbounded memory growth
	private activeTaskIds: Set<string> = new Set(); // Tasks actively being tracked (from files)

	start(vkUrl: string, projectIds: string[], onTaskUpdate: TaskUpdateCallback, debug: boolean = false): void {
		if (this.isPolling) {
			return;
		}

		this.vkUrl = vkUrl.replace(/\/$/, '');
		this.projectIds = new Set(projectIds.filter(id => id)); // Filter empty strings
		this.onTaskUpdate = onTaskUpdate;
		this.debug = debug;
		this.isPolling = true;

		if (this.debug) {
			console.log('[KanDo] Poller starting for projects:', Array.from(this.projectIds));
		}

		if (this.projectIds.size === 0) {
			if (this.debug) {
				console.log('[KanDo] No projects to poll');
			}
			return;
		}

		// Start polling immediately
		this.poll();
	}

	/**
	 * Add a project to poll (e.g., when a new task is created in a different project)
	 */
	addProject(projectId: string): void {
		if (projectId && !this.projectIds.has(projectId)) {
			this.projectIds.add(projectId);
			if (this.debug) {
				console.log('[KanDo] Added project to poll:', projectId);
			}
		}
	}

	/**
	 * Mark a task as actively tracked (associated with a file)
	 */
	trackTask(taskId: string): void {
		this.activeTaskIds.add(taskId);
	}

	/**
	 * Remove a task from active tracking (file deleted or task completed)
	 */
	untrackTask(taskId: string): void {
		this.activeTaskIds.delete(taskId);
		// Also clean up from status maps
		this.lastKnownStates.delete(taskId);
		this.taskProjectMap.delete(taskId);
	}

	/**
	 * Clean up tasks that have reached terminal states and are no longer active
	 */
	private cleanupTerminalTasks(): void {
		const terminalStatuses = new Set(['done', 'cancelled', 'deleted']);
		for (const [taskId, state] of this.lastKnownStates.entries()) {
			// Extract status from combined state "status:executing"
			const status = state.split(':')[0];
			// Only clean up terminal tasks that are not actively tracked by files
			if (terminalStatuses.has(status) && !this.activeTaskIds.has(taskId)) {
				this.lastKnownStates.delete(taskId);
				this.taskProjectMap.delete(taskId);
				if (this.debug) {
					console.log('[KanDo] Cleaned up terminal task:', taskId, state);
				}
			}
		}
	}

	private async poll(): Promise<void> {
		if (!this.isPolling) return;

		const baseUrl = this.vkUrl.replace(/\/+$/, '');
		let hasError = false;

		// Poll each project
		for (const projectId of this.projectIds) {
			if (!this.isPolling) return; // Check if stopped during iteration

			try {
				const url = `${baseUrl}/api/tasks?project_id=${encodeURIComponent(projectId)}`;

				if (this.debug) {
					console.log('[KanDo] Polling:', url);
				}

				const response = await requestUrl({
					url,
					method: 'GET',
				});

				if (response.status === 200) {
					const responseData = response.json;
					const tasks: VKTaskWithAttemptStatus[] = responseData?.data || [];

					if (this.debug) {
						console.log('[KanDo] Poll response for project', projectId, ':', tasks.length, 'tasks');
					}

					// Build a set of current task IDs from the response
					const currentTaskIds = new Set(tasks.map(t => t.id));

					// Check for deleted tasks (tracked tasks no longer in response)
					for (const [taskId, taskProjectId] of this.taskProjectMap.entries()) {
						if (taskProjectId === projectId && !currentTaskIds.has(taskId)) {
							const lastStatus = this.lastKnownStates.get(taskId);
							if (lastStatus && lastStatus !== 'deleted') {
								if (this.debug) {
									console.log('[KanDo] Task deleted:', taskId);
								}
								// Notify about deletion
								if (this.onTaskUpdate) {
									this.onTaskUpdate({
										id: taskId,
										project_id: projectId,
										title: '',
										description: null,
										status: 'deleted',
										parent_task_attempt: null,
										shared_task_id: null,
										created_at: '',
										updated_at: '',
										has_in_progress_attempt: false,
										has_merged_attempt: false,
										last_attempt_failed: false,
										executor: null,
									});
								}
								// Clean up tracking
								this.lastKnownStates.delete(taskId);
								this.taskProjectMap.delete(taskId);
							}
						}
					}

					// Check for status or execution state changes on existing tasks
					for (const task of tasks) {
						// Create combined state key: "status:executing"
						const currentState = `${task.status}:${task.has_in_progress_attempt}`;
						const lastState = this.lastKnownStates.get(task.id);

						// If state changed (and we've seen this task before)
						if (lastState !== undefined && lastState !== currentState) {
							if (this.debug) {
								console.log('[KanDo] Task state changed:', task.id, lastState, '->', currentState);
							}
							if (this.onTaskUpdate) {
								this.onTaskUpdate(task);
							}
						}

						// Track the task with combined state
						this.lastKnownStates.set(task.id, currentState);
						this.taskProjectMap.set(task.id, projectId);
					}

					// Clean up terminal tasks that are no longer actively tracked
					this.cleanupTerminalTasks();

					// Prevent unbounded growth - remove oldest non-active entries if over limit
					if (this.lastKnownStates.size > this.maxTrackedTasks) {
						const entriesToRemove = this.lastKnownStates.size - this.maxTrackedTasks;
						const iterator = this.lastKnownStates.keys();
						let removed = 0;
						for (const key of iterator) {
							if (removed >= entriesToRemove) break;
							// Only remove if not actively tracked
							if (!this.activeTaskIds.has(key)) {
								this.lastKnownStates.delete(key);
								this.taskProjectMap.delete(key);
								removed++;
							}
						}
					}
				}
			} catch (error) {
				hasError = true;
				if (this.debug) {
					console.error('[KanDo] Poll error for project', projectId, ':', error);
				}
			}
		}

		// Handle backoff for errors
		if (hasError) {
			this.consecutiveErrors++;
			this.currentBackoff = Math.min(
				this.baseBackoff * Math.pow(2, this.consecutiveErrors - 1),
				this.maxBackoff
			);
			if (this.debug) {
				console.log(`[KanDo] Poll error, backing off for ${this.currentBackoff}ms`);
			}
		} else {
			this.consecutiveErrors = 0;
			this.currentBackoff = this.pollInterval;
		}

		// Schedule next poll
		if (this.isPolling) {
			this.pollTimer = window.setTimeout(() => this.poll(), this.currentBackoff);
		}
	}

	stop(): void {
		this.isPolling = false;

		if (this.pollTimer) {
			window.clearTimeout(this.pollTimer);
			this.pollTimer = null;
		}

		this.lastKnownStates.clear();
		this.taskProjectMap.clear();
		this.projectIds.clear();
		this.activeTaskIds.clear();
		this.consecutiveErrors = 0;
		this.currentBackoff = this.pollInterval;
	}

	isRunning(): boolean {
		return this.isPolling;
	}

	// Initialize known state without triggering updates
	setKnownState(taskId: string, status: string, executing: boolean = false): void {
		this.lastKnownStates.set(taskId, `${status}:${executing}`);
	}
}
