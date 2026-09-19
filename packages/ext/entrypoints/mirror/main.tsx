import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Mirror } from '@/entrypoints/mirror/Mirror.tsx';
import { Sentinel } from '@/entrypoints/mirror/Sentinel.tsx';

const params = new URLSearchParams(window.location.search);
const isSentinel = params.get('sentinel') === '1';

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isSentinel ? <Sentinel /> : <Mirror />}</StrictMode>,
);
