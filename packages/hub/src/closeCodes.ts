export function isEchoableCloseCode(code: number): boolean {
  return code === 1000 || (code >= 3000 && code <= 4999);
}
