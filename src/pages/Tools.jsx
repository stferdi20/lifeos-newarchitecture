import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';

export default function Tools() {
  const navigate = useNavigate();
  
  useEffect(() => {
    navigate(createPageUrl('Resources'), { replace: true });
  }, [navigate]);

  return null;
}
