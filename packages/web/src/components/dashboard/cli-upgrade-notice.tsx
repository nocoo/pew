"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { MIN_CLIENT_VERSION } from "@pew/core";
import { Button } from "@nocoo/basalt/components/button";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@nocoo/basalt/components/dialog";
import { ChevronDown, Terminal, X } from "lucide-react";
import { CopyButton } from "@/components/ui/copy-button";
import { useRestoreDialogFocus } from "@/lib/restore-dialog-focus";

const installers = [
  { name: "npm", command: "npm install -g @nocoo/pew@latest" },
  { name: "Bun", command: "bun add -g @nocoo/pew@latest" },
];
const mirrors = [
  { name: "腾讯云", registry: "https://mirrors.cloud.tencent.com/npm/" },
  { name: "华为云", registry: "https://repo.huaweicloud.com/repository/npm/" },
];

function Command({ label, command }: { label: string; command: string }) {
  return (
    <fieldset aria-label={label} className="min-w-0 rounded-basalt border border-basalt-border bg-basalt-muted/40 p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-basalt-muted-foreground">{label}</span>
        <CopyButton text={command}>复制</CopyButton>
      </div>
      <code className="block whitespace-pre-wrap break-all font-mono text-xs leading-relaxed text-basalt-foreground sm:text-sm">
        {command}
      </code>
    </fieldset>
  );
}

function UpgradeDialog() {
  const [open, setOpen] = useState(false);
  const request = useRef<Promise<boolean> | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const restoreFocus = useRestoreDialogFocus(open);

  useEffect(() => {
    let active = true;
    // Share the claim across Strict Mode effect replays: the first request
    // consumes the notice, so issuing a second one could hide it entirely.
    request.current ??= fetch("/api/cli-upgrade-notice", { method: "POST" })
      .then(async (response) => response.ok && (await response.json()).show === true)
      .catch(() => false);
    void request.current.then((show) => { if (active) setOpen(show); });
    return () => { active = false; };
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        size="lg"
        onCloseAutoFocus={restoreFocus}
        onOpenAutoFocus={(event) => { event.preventDefault(); titleRef.current?.focus(); }}
      >
        <DialogClose asChild>
          <Button variant="ghost" size="icon" className="absolute right-3 top-3" aria-label="关闭升级提醒">
            <X aria-hidden="true" strokeWidth={1.5} />
          </Button>
        </DialogClose>
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-basalt-lg bg-basalt-primary/10 text-basalt-primary">
          <Terminal className="h-5 w-5" aria-hidden="true" strokeWidth={1.5} />
        </div>
        <DialogHeader>
          <DialogTitle ref={titleRef} tabIndex={-1} className="text-xl outline-none sm:text-2xl">
            升级 Pew CLI 至 3.0
          </DialogTitle>
          <DialogDescription className="pt-1 text-sm leading-relaxed">
            低于 {MIN_CLIENT_VERSION} 的版本将无法上传用量。请在每台运行 Pew 同步的设备上升级，确保 Dashboard 持续更新。
          </DialogDescription>
        </DialogHeader>

        <div className="mt-5 space-y-3">
          <p className="text-sm text-basalt-muted-foreground">按原来的安装方式，选择 npm 或 Bun 中的一种即可。</p>
          {installers.map(({ name, command }) => <Command key={name} label={name} command={command} />)}
          <details className="group rounded-basalt border border-basalt-border p-3">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
              主镜像连接不畅？使用国内镜像
              <ChevronDown className="h-4 w-4 shrink-0 text-basalt-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
            </summary>
            <div className="mt-3 space-y-4">
              <p className="text-xs leading-relaxed text-basalt-muted-foreground">以下命令仅在本次升级使用镜像，无需修改默认镜像设置。</p>
              {mirrors.map(({ name, registry }) => (
                <div key={name} className="space-y-2">
                  <p className="text-sm font-medium">{name}</p>
                  {installers.map((installer) => (
                    <Command key={installer.name} label={`${name} · ${installer.name}`} command={`${installer.command} --registry=${registry}`} />
                  ))}
                </div>
              ))}
            </div>
          </details>
          <Command label="升级后，确认版本并重新同步" command="pew --version && pew sync" />
          <p className="text-xs leading-relaxed text-basalt-muted-foreground">
            确认版本为 {MIN_CLIENT_VERSION} 或更高。此提醒仅显示一次，跳过后旧版本仍无法上传。
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>跳过且以后不再显示</Button>
          <Button onClick={() => setOpen(false)}>我已升级</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CliUpgradeNotice() {
  const { data: session, status } = useSession();
  const userId = session?.user?.id;
  // A new account gets a fresh claim; signing out cannot leave a stale dialog.
  return status === "authenticated" && userId ? <UpgradeDialog key={userId} /> : null;
}
