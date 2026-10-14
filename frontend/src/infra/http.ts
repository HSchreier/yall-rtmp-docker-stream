import axios, { AxiosError } from 'axios';
import type { AxiosInstance } from 'axios';
import { useAuthStore } from '../store/auth.store';
import { eventBus } from './event-bus';

export class HttpClient {
  private client: AxiosInstance;

  constructor() {
    const apiBase = (import.meta.env as Record<string, unknown>).VITE_API_BASE as string | undefined;
    const baseURL = apiBase ? `${apiBase}/api` : '/api';
    this.client = axios.create({
      baseURL,
      timeout: 10000,
    });

    // Add auth header
    this.client.interceptors.request.use((config) => {
      const { token } = useAuthStore.getState();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });

    // Handle errors
    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {
        const message = this.getErrorMessage(error);

        if (error.response?.status === 401) {
          // Unauthorized — logout
          useAuthStore.getState().clearToken();
          window.location.href = '/';
        } else {
          // Show error toast
          eventBus.emit('notification:show', {
            message,
            type: 'error',
          });
        }

        return Promise.reject(error);
      }
    );
  }

  private getErrorMessage(error: AxiosError): string {
    if (error.response?.data) {
      const data = error.response.data as Record<string, unknown>;
      if (typeof data.error === 'object' && data.error !== null) {
        const errorObj = data.error as Record<string, unknown>;
        return String(errorObj.message || 'An error occurred');
      }
      if (typeof data.error === 'string') {
        return data.error;
      }
    }
    return error.message || 'An error occurred';
  }

  get<T>(url: string) {
    return this.client.get<T>(url);
  }

  post<T>(url: string, data?: unknown) {
    return this.client.post<T>(url, data);
  }

  put<T>(url: string, data?: unknown) {
    return this.client.put<T>(url, data);
  }

  delete<T>(url: string) {
    return this.client.delete<T>(url);
  }
}

export const httpClient = new HttpClient();
