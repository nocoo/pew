import { describe, it, expect } from "vitest";
import { isSSHSession } from "../utils/ssh.js";

describe("isSSHSession", () => {
  it("returns false when no SSH env vars are set", () => {
    expect(isSSHSession({})).toBe(false);
  });

  it("returns true when SSH_CLIENT is set", () => {
    expect(isSSHSession({ SSH_CLIENT: "192.168.1.1 12345 22" })).toBe(true);
  });

  it("returns true when SSH_TTY is set", () => {
    expect(isSSHSession({ SSH_TTY: "/dev/pts/0" })).toBe(true);
  });

  it("returns true when SSH_CONNECTION is set", () => {
    expect(isSSHSession({ SSH_CONNECTION: "192.168.1.1 12345 10.0.0.1 22" })).toBe(true);
  });

  it("returns true when multiple SSH env vars are set", () => {
    expect(
      isSSHSession({
        SSH_CLIENT: "192.168.1.1 12345 22",
        SSH_TTY: "/dev/pts/0",
        SSH_CONNECTION: "192.168.1.1 12345 10.0.0.1 22",
      })
    ).toBe(true);
  });

  it("returns false when env vars are empty strings", () => {
    expect(isSSHSession({ SSH_CLIENT: "", SSH_TTY: "", SSH_CONNECTION: "" })).toBe(false);
  });

  it("ignores unrelated env vars", () => {
    expect(isSSHSession({ HOME: "/home/user", PATH: "/usr/bin" })).toBe(false);
  });
});
