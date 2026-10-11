import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import retroApi from '../api/retroApi';

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: () => retroApi.get('/settings').then((r) => r.data),
  });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch) => retroApi.put('/settings', patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });
}

export function useForceSync() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => retroApi.post('/settings/sync').then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['channels'] });
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });
}

export function useStatus() {
  return useQuery({
    queryKey: ['status'],
    queryFn: () => retroApi.get('/status').then((r) => r.data),
    refetchInterval: 15_000,
  });
}
