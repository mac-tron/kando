import { requestUrl, RequestUrlParam } from 'obsidian';
import {
	VKProject,
	VKTask,
	VKTaskWithAttemptStatus,
	VKTaskAttempt,
	VKGitBranch,
	VKApiResponse,
	CreateTaskPayload,
	UpdateTaskPayload,
	CreateTaskAttemptPayload,
	VKExecutorProfiles,
} from './types';

export class VKApiClient {
	private baseUrl: string;
	private timeout: number = 30000; // 30 second timeout

	constructor(baseUrl: string) {
		this.baseUrl = baseUrl.replace(/\/$/, '');
	}

	setBaseUrl(url: string): void {
		this.baseUrl = url.replace(/\/$/, '');
	}

	private async request<T>(
		method: string,
		path: string,
		body?: unknown
	): Promise<T> {
		const url = `${this.baseUrl}${path}`;

		const params: RequestUrlParam = {
			url,
			method,
			headers: {
				'Content-Type': 'application/json',
			},
			throw: false, // Handle errors manually for better error messages
		};

		if (body) {
			params.body = JSON.stringify(body);
		}

		// Track timeout for proper cleanup
		let timeoutId: ReturnType<typeof setTimeout> | undefined;

		try {
			// Create a timeout promise with cleanup tracking
			const timeoutPromise = new Promise<never>((_, reject) => {
				timeoutId = setTimeout(
					() => reject(new Error(`Request timeout after ${this.timeout}ms`)),
					this.timeout
				);
			});

			// Race between the request and timeout
			const response = await Promise.race([
				requestUrl(params),
				timeoutPromise
			]);

			// Clean up timeout on success
			if (timeoutId) clearTimeout(timeoutId);

			// Check HTTP status first
			if (response.status < 200 || response.status >= 300) {
				const errorMessage = response.json?.message || `HTTP ${response.status}`;
				throw new Error(`${method} ${path} failed: ${errorMessage}`);
			}

			const data = response.json as VKApiResponse<T>;

			if (!data.success) {
				throw new Error(`${method} ${path} failed: ${data.message || 'API request failed'}`);
			}

			return data.data as T;
		} catch (error) {
			// Clean up timeout on error
			if (timeoutId) clearTimeout(timeoutId);

			if (error instanceof Error) {
				// Add context if not already present
				if (!error.message.includes(path)) {
					error.message = `${method} ${path} failed: ${error.message}`;
				}
				throw error;
			}
			throw new Error(`${method} ${path} failed: ${error}`);
		}
	}

	// Connection test
	async testConnection(): Promise<boolean> {
		try {
			await this.getProjects();
			return true;
		} catch {
			return false;
		}
	}

	// Projects
	async getProjects(): Promise<VKProject[]> {
		return this.request<VKProject[]>('GET', '/api/projects');
	}

	async getProject(projectId: string): Promise<VKProject> {
		return this.request<VKProject>('GET', `/api/projects/${encodeURIComponent(projectId)}`);
	}

	async getProjectBranches(projectId: string): Promise<VKGitBranch[]> {
		return this.request<VKGitBranch[]>(
			'GET',
			`/api/projects/${encodeURIComponent(projectId)}/branches`
		);
	}

	// Tasks
	async getTasks(projectId: string): Promise<VKTaskWithAttemptStatus[]> {
		return this.request<VKTaskWithAttemptStatus[]>(
			'GET',
			`/api/tasks?project_id=${encodeURIComponent(projectId)}`
		);
	}

	async getTask(taskId: string): Promise<VKTask> {
		return this.request<VKTask>('GET', `/api/tasks/${encodeURIComponent(taskId)}`);
	}

	async createTask(payload: CreateTaskPayload): Promise<VKTask> {
		return this.request<VKTask>('POST', '/api/tasks', payload);
	}

	async updateTask(taskId: string, payload: UpdateTaskPayload): Promise<VKTask> {
		return this.request<VKTask>('PUT', `/api/tasks/${encodeURIComponent(taskId)}`, payload);
	}

	// Task Attempts
	async createTaskAttempt(payload: CreateTaskAttemptPayload): Promise<VKTaskAttempt> {
		return this.request<VKTaskAttempt>('POST', '/api/task-attempts', payload);
	}

	async getTaskAttempts(taskId: string): Promise<VKTaskAttempt[]> {
		return this.request<VKTaskAttempt[]>(
			'GET',
			`/api/task-attempts?task_id=${encodeURIComponent(taskId)}`
		);
	}

	async getTaskAttempt(attemptId: string): Promise<VKTaskAttempt> {
		return this.request<VKTaskAttempt>('GET', `/api/task-attempts/${encodeURIComponent(attemptId)}`);
	}

	// Executor Profiles
	async getProfiles(): Promise<VKExecutorProfiles> {
		// The profiles API returns { content: string, path: string }
		// where content is the JSON-stringified profiles
		const response = await this.request<{ content: string; path: string }>(
			'GET',
			'/api/profiles'
		);
		return JSON.parse(response.content) as VKExecutorProfiles;
	}
}
