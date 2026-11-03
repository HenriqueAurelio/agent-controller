import { describe, expect, it } from 'vitest';
import { isLocalUrl, previewAddress } from '@shared/preview';

describe('the addresses of the preview', () => {
  it('takes only pages of this machine', () => {
    expect(isLocalUrl('http://localhost:3000/')).toBe(true);
    expect(isLocalUrl('https://127.0.0.1:8443/app')).toBe(true);
    expect(isLocalUrl('http://[::1]:5173')).toBe(true);
    expect(isLocalUrl('http://example.com')).toBe(false);
    expect(isLocalUrl('http://localhost.evil.com')).toBe(false);
    expect(isLocalUrl('file:///etc/passwd')).toBe(false);
    expect(isLocalUrl('javascript:alert(1)')).toBe(false);
  });

  it('reads a port, a host with a port, or a whole address', () => {
    expect(previewAddress('3000')).toBe('http://localhost:3000');
    expect(previewAddress('localhost:5173/x')).toBe('http://localhost:5173/x');
    expect(previewAddress(' http://127.0.0.1:8080 ')).toBe('http://127.0.0.1:8080/');
    expect(previewAddress('google.com')).toBeNull();
  });
});
