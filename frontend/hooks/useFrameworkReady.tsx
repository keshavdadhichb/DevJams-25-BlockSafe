import { useEffect } from 'react';

export function useFrameworkReady() {
  useEffect(() => {
    console.log('Framework ready');
  }, []);
}
