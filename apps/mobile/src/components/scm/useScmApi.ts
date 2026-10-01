import { useApi } from '../../services/api/useApi';

export function useScmApi() {
  return useApi().scm;
}
