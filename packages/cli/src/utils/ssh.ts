/**
 * SSH/headless session detection.
 *
 * Standard environment variables set by sshd when a client connects:
 * - SSH_CLIENT  — set on login sessions
 * - SSH_TTY     — set when a pseudo-terminal is allocated
 * - SSH_CONNECTION — set on all SSH connections (login + non-interactive)
 */

/**
 * Returns true when the process is running inside an SSH session.
 */
export function isSSHSession(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.SSH_CLIENT || env.SSH_TTY || env.SSH_CONNECTION);
}
