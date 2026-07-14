# 45 — Codex notifier forwarding-cycle containment

> **Status: proposed / awaiting review** (2026-07-14)
>
> 针对 GitHub [Issue #318](https://github.com/nocoo/pew/issues/318) 中
> `Pew → third-party wrapper → Pew` 持久化转发环，定义一个刻意收敛的首版
> 防护方案。目标不是理解任意第三方 notifier 的内部图，而是保证 Pew 即使接入
> 错误或不透明的 wrapper，也不会无界创建 Node/Bun 子进程。

## 一、结论与产品决策

Issue #318 的**核心机制成立**，但有明确前置条件：

1. 用户安装过 Pew 的 Codex notifier（`pew init` 或
   `pew init --source=codex`）；
2. 同时存在另一个会保存并转发 previous notifier 的 wrapper；
3. 两者经过交替安装或升级，最终互相保存；
4. 第二个 wrapper 确实会继续执行它保存的 Pew 命令。

Issue 中的 Wrapper A 已匿名，无法独立核实它的实现及现场指标。因此我们的结论是：

- Pew 单独使用不会凭空形成双节点环；
- 给定 Wrapper A 所描述的 preserve-and-forward 行为，当前 Pew 确实无法终止该环；
- `v2.24.1` 与当前 `v2.25.0` 的两个关键文件
  `notify-handler.ts` / `codex-notifier.ts` 对应 Git blob 相同，问题尚未修复；
- 具体 CPU、进程数和约 110 万 run artifacts 是现场证据，仓库代码只能证明它们
  **机制上合理**，不能独立复核具体数值。

本方案采用以下产品语义：

> Pew notifier 是**可合并的同步意图**，不是逐事件可靠消息队列。同一个短窗口内
> 的多个 notify 可以收敛成一个 Pew worker 和一次 sync。

saved-original notifier 的转发语义被明确定为**每 admission batch 最多一次**——
不是"因为 Pew 自己 coalesce 所以第三方也 coalesce"，而是因为极简的 containment
要求 gate 必须同时覆盖 Pew worker spawn 和 original forwarding，见 §4.5。任何
"逐事件保证"在没有独立 acknowledged queue 的前提下都只是名义上的。

## 二、问题原理

### 2.1 持久化循环如何形成

一个最小安装顺序是：

```text
初始：Codex → Wrapper A

第一次 pew init：
  Codex → Pew
  Pew saved-original → A

重新安装 A：
  Codex → A
  A saved-original → Pew

再次 pew init：
  Codex → Pew
  Pew saved-original 仍然 → A
  A saved-original          → Pew
```

`installCodexNotifier()` 只在 `codex_notify_original.json` 不存在时保存当前
notify。已有 backup 时，即使 top-level notify 的所有权已经被其他程序接管并再次
切换回来，也不会重新评估 ownership 或 backup provenance。

最终磁盘图是：

```text
~/.codex/config.toml
  └── Pew notify.cjs
        └── codex_notify_original.json → Wrapper A
                                              └── A saved-original → Pew notify.cjs
```

重启会终止当前进程，但不会修改这三处持久化引用；下一次 Codex completion 仍可
重新触发。

### 2.2 当前 handler 为什么会放大

生成的 `notify.cjs` 当前按以下顺序执行：

```text
1. append notify.signal
2. detached spawn `pew notify --source=...`
3. Codex 场景读取 codex_notify_original.json
4. detached spawn saved-original
5. handler 退出
```

在 `Pew → A → Pew` 中：

```text
Pew handler
  ├── spawn Pew worker #1
  └── spawn A handler
        ├── spawn A worker #1       (按 Issue 对 A 的描述)
        └── spawn Pew handler
              ├── spawn Pew worker #2
              └── spawn A handler
                    └── ...
```

这是一个无终止条件的线性反馈链，不必指数分叉也能形成风暴：handler 产生下一跳
的速度高于 worker 退出速度时，等待锁、执行 sync、等待 trailing timer 的进程会
持续积累。

### 2.3 现有保护为什么无效

| 保护 | 当前发生位置 | 无法 containment 的原因 |
|---|---|---|
| `isSelfNotify()` | handler 转发前 | 只比较当前 `notify.cjs` 的精确路径，看不见 `Pew → A → Pew` |
| `sync.lock` | Pew worker 内 | worker 已经被创建，只能串行 sync，不能限制进程创建 |
| cooldown | worker 获得协调状态后 | worker 已存在，handler 也已转发 original |
| `notify.signal` | handler 开头 | 当前只是 size-based dirty marker，不是 worker admission gate |
| `trailing.lock` | cooldown skip 后 | 只限制 trailing sleeper，不限制 handler/worker 创建 |

因此，只修改 coordinator 的锁或 cooldown 不能解决 Issue #318。保护必须前移到
生成的 handler，并位于**两个 spawn 之前**。

## 三、目标与非目标

### 3.1 必须满足的安全不变量

1. 检测到 Pew re-entry 或 chain 长度超上限时，本次调用产生**零子进程**。
2. 每个 admission window、每个 Pew state directory 中：
   - 至多一个 handler 成为 **sync gate owner**（负责创建 Pew worker）；
   - 至多一个 handler 成为 **Codex forward gate owner**（负责调用 saved-original）。
   两个 gate 的胜负相互独立：同一个 Codex handler 可以在 sync gate 输、forward gate
   赢，或反之。
3. 每个 gate 的 loser 不做对应 spawn：
   - sync gate loser：**不**创建 Pew worker；
   - forward gate loser：**不**调用 saved-original；
   - 两个 gate 都 loser 的 handler：**总 child spawn = 0**（含不转发 saved-original）。
4. gate 的 `EEXIST` 表示"该 gate 已有 owner"，走该 gate 的 loser 路径；`EACCES`、
   `EIO` 等其他错误必须**对该 gate** fail-closed（该 gate 对应 spawn = 0），
   另一 gate 仍独立参与竞争与判定。
5. admission 不依赖 PID、Unix signal、`flock` 或 shell。
6. worker 启动失败或崩溃最多影响当前短窗口；下一窗口可自动恢复。
7. gate artifact 必须有界清理，不能把进程风暴换成 inode 风暴。
8. 任何新增 chain metadata 只放在 child environment，不修改第三方 argv 或 Codex
   payload contract。
9. 当前 sync 数据正确性、cursor、queue、cooldown 和 trailing-edge 语义不得回退。

### 3.2 本轮不做

- 不解析任意第三方 wrapper 的内部配置或构建完整 notifier graph；
- 不实现跨文件 ownership transaction、generation database 或完整 router；
- 不引入 PID-based active-worker lease；
- 不承诺 saved-original 的逐事件可靠投递；
- 不处理 Issue 报告中的 run-log retention，另立 bounded-retention 任务；
- 不以杀 Node 进程作为正常恢复机制。

## 四、推荐方案

本轮采用两层独立保护：

1. **调用链 guard**：能识别时，第一次回入即终止；
2. **原子时间窗口 admission gate**：即使第三方丢弃环境，也限制进程创建速率。

### 4.1 稳定 Pew instance ID 与调用链

生成 `notify.cjs` 时烘焙一个稳定、非敏感的 `INSTANCE_ID`。推荐由规范化后的
`stateDir` 计算短 SHA-256：

```text
INSTANCE_ID = sha256(canonicalize(stateDir)).slice(0, 16)
```

`canonicalize()` 定义：

- POSIX：`path.resolve(stateDir)`
- Windows：`path.resolve(stateDir).toLowerCase()`

Windows 上 NTFS/ReFS 默认大小写不敏感，`C:\Users\Foo` 与 `c:\users\foo` 是同一
物理路径；`path.resolve()` 不做 case-fold，因此必须显式 lowercase，否则同一
stateDir 从不同大小写路径 launch 时会得到不同 INSTANCE_ID，chain guard 失效。
POSIX 大小写敏感，不做 lowercase。相同 stateDir 下的 Pew 升级保持同一 ID；不同
安装路径得到不同 ID。

handler 读取内部环境变量：

```text
PEW_NOTIFY_CHAIN=<id1>,<id2>,...
```

约束：

- chain 已包含当前 ID：视为 re-entry，零 signal、零 spawn；
- chain 字符串输入长度硬上限 2048 bytes，超限 fail-closed（零 signal、零 spawn）；
- 转发 original 时复制环境并追加当前 ID；
- 不给第三方命令追加私有 argv；
- Pew worker 不依赖 chain 值做 sync correctness 判断。

**不引入独立的 `MAX_HOPS` 限额。** 只要环境被第三方保留，`chain.includes(INSTANCE_ID)`
已经能在第一次回入时终止任何返回 Pew 的环；环境被丢弃时任何 hop 计数同样失效，
由 §4.2 的 bucket gate 处理。多引入一个阈值只会增加决策面（当前 window 内合理的
`A → B → Pew → C → Pew` 也会被误伤）和测试面，收益为零。2048-byte chain 长度
上限本身已经是有效的 defense-in-depth 上界。

异常路径写一个固定覆盖式诊断 `last-notify-guard.json`，内容包含 reason、时间、
chain 长度和当前 instance ID。禁止按 invocation 追加新诊断文件。

### 4.2 原子时间 bucket gate

推荐首版常量：

```text
ADMISSION_WINDOW_MS = 2_000
```

**两个独立 bucket gate**，每 bucket 各自 exclusive-create：

```text
sync gate    = <stateDir>/notify-admission/sync-<bucket>.lock
forward gate = <stateDir>/notify-admission/forward-codex-<bucket>.lock
```

- **sync gate**：全 source 共享，每 bucket 最多一个 Pew worker。任何 source 的
  handler 到达都尝试 wx create，winner 负责 spawn Pew worker。
- **forward gate**：**只 Codex**（当前唯一有 saved-original 概念的 source），
  每 bucket 最多一次 saved-original callback。

为什么必须拆两把锁：如果只有一个共享 gate，先到的 Claude/Gemini handler 抢到
gate 后 spawn Pew worker，随后 Codex handler 撞 `EEXIST` 成为 loser、零 spawn ——
Codex 的 saved-original 完全不会被调用，因为 `notify.signal` 不记录 source。
Codex 用户可能因此发现"我原来接的 notifier 在别的 source 活跃时被静默吞掉"。
拆两个 gate 后：Codex handler 无论 sync gate 输赢，都独立参与自己的 forward gate
竞争，最多一次 saved-original callback；Pew worker 仍全局最多一个。同一 bucket
最多 2 个 child 进程（1 个 Pew worker + 1 个 Codex saved-original）的上界不变。

handler 使用注入的 `now()` 计算 bucket，**必须在 append notify.signal 之后**
（见 §4.3）：

```text
bucket = floor(now / ADMISSION_WINDOW_MS)
```

通过 Node `fs.writeFileSync()` 的 exclusive-create 原子竞争：

```js
writeFileSync(gate, "", { flag: "wx" });
```

判定（对两把锁独立适用）：

- 成功：本窗口该 gate 的唯一 owner。
- `EEXIST`：已有 owner，本 gate 走 loser 路径（对该 gate 零 spawn）。
- 其他任何 errno（`EPERM` / `EACCES` / `EBUSY` / `EIO` / `EROFS` / ...）：
  一律 fail-closed，尝试写固定诊断（诊断本身也是 best-effort，见 §5.1），本 gate
  零 spawn。

**只有 `EEXIST` 能证明"已有 owner"。** 其他错误意味着权限不足、杀毒软件短暂锁、
文件系统只读、磁盘故障等运行时异常状态；此时把请求当作正常 coalesce 会**默默丢
signal**——上层无 spawn、无 worker，谁也不会消费本次事件。fail-closed 至少能通过
`last-notify-guard.json`（若可写）让下一次成功的 handler 看到证据。

（后续 §4.4 gate cleanup 阶段的 `EPERM` / `EBUSY` 才是 best-effort 忽略，见那节。
两处的错误语义不能互相借用。）

选择 time bucket 而不是 PID active lock 的原因：

- 不需要 handler → worker 的复杂 ownership handoff；
- 不受 PID reuse 和 `process.kill(pid, 0)` 平台差异影响；
- 每个 bucket 号只在时钟前进到该 bucket 窗口时才被使用，配合下面的过期采样和
  grace-period cleanup（§4.3、§4.4），单个 handler invocation 期间 gate path 的
  拥有权语义仍然确定；
- winner 崩溃只抑制当前 2 秒，不会永久锁死；
- 同一 bucket 的并发行为可以用确定时钟精确测试。

**注意 gate path 并非绝对"永不复用"**：worker 完成 sync 后清理 gate 文件、handler
恢复运行时时钟可能已经跨过 bucket 边界，纯粹依靠"文件存在与否"会引入 TOCTOU
（见 §4.3 过期采样与 §4.4 grace-period 说明）。设计上通过两个额外机制补齐：
gate 创建成功后立刻再采一次时钟确认 bucket 未过期；worker 保留刚结束 bucket 的
gate 文件到 grace 期后再删。

bucket 边界附近最多可能产生两个相邻 bucket 的 winner。现有 `sync.lock` 继续负责
串行实际 sync；本方案负责把创建率从"每个事件一个 worker"限制为"每窗口最多
一个 worker"。

### 4.3 handler 的严格操作顺序

**顺序约束**：`now` 必须**在 `append notify.signal` 之后**采样并计算 bucket。
先 append 再 sample 保证：即便 handler 在采样前被调度器暂停并跨过 bucket 边界，
signal 已经写进磁盘，当前或下一 bucket 的 winner worker 都会读到；若在 sample
之后再暂停，最坏结果是拿到已过期的 bucket 号，gate 竞争会走 `EEXIST` 或过期路径，
但**不会**绕开 §4.4 的 lost-wakeup 修复。反过来先 sample 再 append 会引入具体
漏洞：

```text
handler enters
  → sample old bucket B, computes gate path
  → OS pause for > W ms
  → resumes, tries wx create on B-gate: EEXIST (previous B winner already ran)
  → appends signal
  → exit
→ signal appended AFTER previous B worker exited, and this handler is a
  loser for a bucket that has already retired → nothing consumes the signal
```

正确顺序：

```text
parse source / payload
  │
  ├── validate chain length (≤ 2048 bytes) + chain-contains-self
  ├── chain contains self? ──────────────── yes → bounded diagnostic → exit
  │
  ├── append notify.signal                     ← 先写 signal
  ├── now = injected clock                     ← 再采样时间
  ├── bucket = floor(now / W)
  │
  ├── exclusive-create sync-<bucket>.lock      ← 全 source 共享
  │     ├── success ─→ post-create expiry check (see below)
  │     │              └─ 未过期 → spawn exactly one Pew worker (with notBefore)
  │     │                 已过期 → skip Pew worker
  │     ├── EEXIST  ─→ (fall through to forward gate)
  │     └── other error → best-effort diagnostic; skip Pew worker
  │
  ├── if source == "codex":                    ← 无条件竞争 forward gate
  │     exclusive-create forward-codex-<bucket>.lock ← Codex only
  │       ├── success ─→ post-create expiry check
  │       │              └─ 未过期 → **read & validate saved-original backup**
  │       │                          ├─ valid  → spawn saved-original once with updated chain env
  │       │                          └─ 缺失/损坏 → skip forwarding (slot 已消耗)
  │       │                 已过期 → skip forwarding
  │       ├── EEXIST  ─→ skip forwarding (already forwarded this bucket)
  │       └── other error → best-effort diagnostic; skip forwarding
  │
  └── exit
```

**post-create expiry check**：`wx create` 成功后立即再采样一次时钟
`now2 = injected clock`，若 `floor(now2 / W) !== bucket`，说明本次调用曾在
`bucket = floor(now / W)` 之后被暂停，跨过了 bucket 边界；这时刚 create 成功的
`bucket` gate 文件可能是**上一 bucket 的 worker 已经清理后重新出现的同名文件**，
不能凭它拥有本 bucket 的 spawn 权。此时该 gate 对应的 spawn = 0；handler
继续走 exit 流程（signal 已经在 §4.3 开头 append，下一 bucket 的 worker 会消费
它）。若 `now2` 与 `now` 同 bucket，即为真 owner，正常 spawn。

第二次采样只增加一次注入时钟读取，无系统调用；即使被暂停也只是把跨 bucket 场景
识别得更准。此机制与 §4.4 的 grace-period cleanup 协同：worker 不立即删除刚结束
bucket 的 gate，而是延后到 gate 号"已过期两个 window 以上"时再统一清理（见 §4.4）；
这样过期采样命中前，gate 文件在磁盘上还在，`wx create` 会先拿到 `EEXIST`，
根本不会走到 expiry check 分支。expiry check 是防御 grace-period 与调度暂停时间
量级同数的极端情况的兜底。

两把 gate 的竞争彼此独立：Codex handler 即使在 sync gate 上是 loser，仍需要尝试
forward gate；非 Codex handler 只参与 sync gate。任何 handler 单次调用最多 spawn
1 个 Pew worker + 1 个 saved-original，与只用一把 gate 时的资源上界一致，但不会
因为其他 source 抢先就吞掉 Codex 的 saved-original callback。

**先竞争 forward gate 再读 backup**：Codex handler 不能在竞争 forward gate 之前
先读 `codex_notify_original.json`，否则每个 Codex loser 都要做一次 JSON read +
parse + validate（相对文件 append 与 wx create 的开销是数量级的差距）。正确顺序
是先争 gate；只有 winner 才读 backup 并校验，其他 handler 走 EEXIST 立即退出，
零 JSON I/O（§5.1）。backup 缺失、格式非法、或指向 self 时，forward slot 本轮
被消费但不 spawn——这是本 bucket 内合理的 fail-closed：下一 bucket 再产生新的
forward winner，届时若 backup 恢复正常仍会正确 spawn。

### 4.4 窗口末尾执行一次 sync

`notBefore` 不是性能优化，它关掉一个 **lost-wakeup 窗口**。

具体路径（无 notBefore 时）：

```text
t0             winner handler admitted, spawn worker
t0 + Δ1        worker runs coordinatedSync()
t0 + Δ2        worker 完成 sync，check signal size = 0，退出
t0 + Δ3        loser handler 进入
                 append notify.signal
                 exclusive-create gate → EEXIST → 立即 exit
                 （因为同 bucket 还没结束，仍是 loser）
                 → 无人再消费本次 append 的 signal
```

`t0 + Δ3 < (bucket + 1) * W`，即使 loser 也在同一个 bucket 里，它 append 的 signal
永远没有 owner。coordinator 的 follow-up trailing 机制只在同一个 worker 的生命
周期内工作，一旦 worker 已确认 signal=0 后退出，就没有 follow-up 可挂。下一个
worker 要等下一个 bucket 才产生。

owner worker 因此必须**等到 bucket 结束**再进入 `coordinatedSync()`：

```text
notBefore = (bucket + 1) * ADMISSION_WINDOW_MS
delay     = max(0, notBefore - now)
```

保证 sync 前所有同 bucket 的 signal 都已经 append，避免上面的丢失。跨 bucket 到达
的事件本来就是下一个 bucket 的 owner 的责任。

`notBefore` 只传给 Pew 自己的 worker，放在内部环境变量或显式内部 option，不得
转发给 original wrapper。worker 是 detached、handler 已经 exit，因此这 `< W` 秒
延迟不阻塞 Codex 本身，只影响 dashboard 数据新鲜度。

窗口结束后：

1. worker 运行现有 `coordinatedSync()`；
2. sync 期间的新 signal 继续由 coordinator follow-up 机制消费；
3. **不立即删除自己的 gate 文件**。设 `GATE_GRACE_BUCKETS = 2`：worker 只清理
   `bucket ≤ current_bucket − GATE_GRACE_BUCKETS` 的 `sync-*.lock` 与
   `forward-codex-*.lock`。刚结束 bucket 与相邻 bucket 的 gate 文件保留在磁盘上，
   使任何"曾在旧 bucket 内采样、随后被暂停"的 handler 恢复运行时仍会拿到
   `EEXIST` 而非空目录，避免同 bucket 二次 winner。
4. §4.3 的 post-create expiry check 是 grace-period 之外的兜底：即使 handler 被
   暂停的时长超过 `GATE_GRACE_BUCKETS × W`，恢复后 `wx create` 成功也会因为
   `now2` 落在新 bucket 而放弃对旧 bucket 的 spawn 权，仍不会出现两个同 bucket
   owner。

worker cleanup 与 handler 的 post-create expiry check 两个机制**必须共存**：单靠
grace-period 抵御不了任意长的调度暂停；单靠 expiry check 又要求 handler 每次都
多做一次时钟读取加分支判断——两个机制正交，一起构成完整的 TOCTOU 防御。

选择"扫全目录删所有过期 bucket"而不是"只删前一 bucket"是刻意的：跨多个 bucket
的崩溃残留（例如 worker 启动即 crash 若干次）在"只删前一 bucket"策略下永远不会
被清理，会随时间无界积累。`notify-admission/` 是本方案私有的小目录，扫描 cost
O(残留数)，即使残留几十上百个也只是一次 `readdir` + 若干 `unlink`，远低于一次
sync；且只 worker 做，loser 依然零目录扫描。清理失败不影响 correctness，下一个
worker 会重试。绝不扫 state directory 其余部分。

### 4.5 saved-original 转发语义

**语义：同一个 admission batch 最多转发 saved-original 一次。**

真正的理由不是"Pew 的 sync 是 coalesce 的，因此第三方也必须 coalesce"——那不成
立，两个流的传递语义没有强制耦合关系。真正的理由是：极简且**不依赖第三方
运行时行为**的 containment 要求 forwarding 也必须走原子 gate。如果 loser handler
仍无条件转发 original：

- `Pew → A → Pew` 且 A 保留环境时，chain guard 能拦；
- 但 A 丢弃环境时，loser handler 转发到 A，A 立即回到 Pew handler，仍落在同一
  bucket 内。这个新的 Pew handler 撞 sync gate 拿到 `EEXIST`，走 loser 路径……
  只要 A 的回环延迟低于 `W`，这条链在**同一个 bucket 内**就能持续高速运转：
  Pew worker 创建率被限制到 `1/W`，但 handler 和 A 侧的进程数与创建率**不受任何
  限制**，Issue #318 描述的正是这种 handler 层进程风暴，只是 Pew worker 换成了
  别人的 worker，问题没有解决；
- 更糟：任何"handler 在 gate 后仍做外部 spawn"的实现都增加"可漏掉的一半保护"，
  破坏 §3.1 不变量 3（loser 零子进程）。

把 original forwarding 也纳入 admission gate（本方案里是**独立的** forward gate，
见 §4.2）是唯一能保证：

- 单一原子决策点：`wx create` 成功 ⇔ 本 handler 有权对应 spawn；
- forwarding loser 也是零 forward spawn；
- gate 出错时的 fail-closed 语义对该 spawn 类型独立生效。

代价：第三方 notifier 如果把每次 Codex completion 当作必须逐条送达的事件，同一
`ADMISSION_WINDOW_MS` 内可能只被调用一次。这是本方案有意接受的产品语义变更，
因为在没有独立 acknowledged per-event queue 的前提下（§3.2 明确不做），任何
"逐事件保证"都只是名义上的。

不为 saved-original 提供 escape hatch（例如 `--forward-every-event` 或类似 flag）：
逃生开关会把 loser 路径重新引入 spawn，等同于取消本节的保证。若确实有 wrapper
必须逐事件，独立的 acknowledged queue 是唯一正确解，另立方案，不属于本轮。

### 4.6 环境被第三方丢弃时的残余风险

如果 A 完整复制环境，chain guard 会在第一次 `Pew → A → Pew` 回入时终止。

如果 A 丢弃环境：

- 立即回入仍会撞到当前 bucket gate并退出；
- 恰好跨 bucket 的回入最多产生相邻两个 winner；
- 如果 A 每次都延迟超过 2 秒，链可能低频持续，但创建率被限制为每 2 秒最多一次，
  不再是无界高频进程风暴。

首版接受这个 residual risk，以换取无 PID lease、无持久 circuit-breaker 的简单
实现。若 review 要求“第三方丢弃环境也必须最终停止”，应追加一个独立的 bounded
burst breaker，例如“10 秒内超过 3 个 admitted batches，阻断 60 秒”；这会增加
状态、阈值误判和测试面，不默认纳入极简 P0。

## 五、性能约束

### 5.1 handler 热路径预算

正常 sync-gate winner（任何 source）：

- 一次 `mkdirSync(..., { recursive: true })`（目录通常已存在）；
- 一次 `appendFileSync(notify.signal)`；
- 一次 `writeFileSync(sync-<bucket>.lock, "", { flag: "wx" })`；
- 一个 Pew worker spawn。

Codex handler 额外（无论 sync gate 输赢）：

- 无条件一次 `writeFileSync(forward-codex-<bucket>.lock, "", { flag: "wx" })`；
- forward gate winner 才**在此时**读取并校验 `codex_notify_original.json`；
  backup valid 且非 self 时 spawn saved-original 一次，缺失/损坏/self 时零 spawn；
- forward gate loser 时零 JSON read、零 spawn。

同窗口 loser（两个 gate 都是 loser 的非-Codex handler，或 Codex 两个 gate 都
loser）：

- 一次 signal append；
- 一次预期为 `EEXIST` 的 exclusive create（非 Codex）或两次（Codex）；
- 零 JSON backup read、零 spawn、零目录扫描。

诊断写入本身也是 best-effort：`writeFileSync(last-notify-guard.json, ...)` 在
gate 失败的同一底层原因下（例如 `EACCES` / `EROFS` / `EIO`）可能同样失败。诊断
写失败时**不**升级为进一步 fail 或重试，仍走"零 spawn 后退出"路径。测试断言
"handler 尝试写诊断 且 零 spawn"，不能断言诊断文件一定存在。

文件 append/exclusive-create 的成本远低于启动 Node/Bun/npm 子进程。性能验收不只
测 wall-clock，也必须断言 spawn count；spawn count 才是本问题的核心资源指标。

### 5.2 不允许的性能回退

- loser 不得解析 `codex_notify_original.json`；
- loser 不得执行 `readdir` 清理；
- 不得在 handler 内等待 worker 或 original 完成；
- 不得引入 npm runtime dependency；生成的 `notify.cjs` 保持 standalone；
- 不得为每个被抑制的 invocation 创建诊断文件；
- admission 失败不得 fallback 到“仍然 spawn”。

## 六、可测试性设计

当前 `notify-handler.test.ts` 主要检查生成字符串包含特定文本，无法证明运行时 spawn
上限。实现时应把生成脚本组织为自包含、可注入依赖的 `main()`：

```js
function main({
  fs,
  path,
  spawn,
  now,
  argv,
  env,
  platform,
  exit,
}) {
  // production handler state machine
}
```

生成文件在直接执行时传入真实 Node dependencies；测试通过 `vm.Script` 执行**同一
份生成产物**并注入 fake dependencies。不要在生产代码加入可由外部环境开启的
“test mode”。

### 6.1 L1 单元测试矩阵

同一 bucket 下的并发测试**必须固定注入同一个 `now = T`**（`main({ now })` 的
形参），不允许依赖真实 timer；否则 test 会 flaky 且不能证明"同 bucket 内合并"这
个具体不变量。跨 bucket 的测试改成显式两次注入 `now = T` 和 `now = T + W + 1`。

| Case | 必须断言 |
|---|---|
| 100 次调用、同一 bucket（固定 now=T） | signal append 100；Pew spawn 1；Codex saved-original spawn = 1（backup 存在且非 self） |
| 100 次 Codex 调用、同一 bucket、backup 读取次数 | backup JSON read + parse **恰好 1 次**（仅 forward-gate winner 读）；loser 不接触 backup 文件 |
| 100 次调用、同一 bucket、original backup 缺失/损坏 | Pew spawn 1；saved-original spawn = 0 |
| 不同 source 同一 bucket、Claude 先到、Codex 后到 | Pew spawn 1（Claude 赢 sync gate）；saved-original spawn = 1（Codex 独立赢 forward gate） |
| 不同 source 同一 bucket、Codex 先到、Claude 后到 | Pew spawn 1（Codex 赢 sync gate）；saved-original spawn = 1（Codex 同时赢 forward gate） |
| sync gate EEXIST + forward gate success | Pew spawn = 0；saved-original spawn = 1 |
| sync gate success + forward gate 非-EEXIST 错误 | Pew spawn = 1；saved-original spawn = 0；尝试写诊断 |
| sync gate 非-EEXIST 错误 + forward gate success | Pew spawn = 0；saved-original spawn = 1；尝试写诊断 |
| 两个 gate 都 EEXIST | Pew spawn 0；saved-original spawn 0 |
| 两个 gate 都非-EEXIST 错误 | Pew spawn 0；saved-original spawn 0；尝试写诊断（诊断文件可能因同一底层错误而未写出，测试断言"尝试写"即可，不断言文件存在） |
| 下一 bucket（now=T+W+1） | 允许一个新 sync owner + 一个新 forward owner |
| bucket 边界两侧 | 最多两个相邻 bucket 各自一个 sync/forward owner；无同 bucket 双 winner |
| post-create expiry check：采样 bucket B 后 handler 暂停，B 的 worker 完成但 grace-period 未删（正常路径 EEXIST） | Pew spawn 0；handler 走 EEXIST loser |
| post-create expiry check：暂停时间超 `GATE_GRACE_BUCKETS × W`，B gate 已被清理，handler 恢复后 wx create 成功但 `now2` 已进入新 bucket | Pew spawn 0；不 spawn 旧 bucket 的 worker；signal 由下一 bucket 消费 |
| direct self chain | signal 0；child spawn 0 |
| `Pew → A → Pew`，A 保留 env | 第二次 Pew child spawn 0 |
| chain 长度超 2048 bytes | child spawn 0；尝试写诊断 |
| chain 超长/格式异常 | fail-closed；child spawn 0 |
| gate `EEXIST` | 正常 loser 路径，无错误日志风暴 |
| gate `EACCES` / `EIO` / `EPERM` / `EBUSY` | 该 gate 对应 spawn = 0；另一 gate 独立参与竞争；尝试写诊断（诊断本身 best-effort，测试断言"handler 调用了 diagnostic 写入路径"，不要求文件持久化） |
| Pew worker spawn 抛错 | 不尝试第二个 worker 补偿；尝试写诊断；同 bucket 后续 loser 仍零 Pew spawn；下一 bucket 恢复 |
| saved-original spawn 抛错 | 不尝试第二次 forward 补偿；同 bucket 后续 Codex handler 撞 forward gate EEXIST 或过期检查，仍零 forward spawn；下一 bucket 恢复 |
| gate cleanup 失败 | sync 结果不受影响；后续 bucket 仍可运行 |
| Windows 路径大小写/分隔符 | 相同 stateDir 生成相同 instance ID（`resolve()` 后 lowercase） |
| 路径/参数含空格 | spawn 使用 argv array，不经过 shell |

对每条断言，测试都必须**精确**报告两个 gate 各自的 spawn 次数：`Pew spawn = 1`
或 `= 0`、`saved-original spawn = 1` 或 `= 0`，不允许 `≤ 1`——模糊上界让实现和
测试同时漂移。诊断文件不做存在性断言，只断言 handler **调用**了 diagnostic 写入
路径（例如通过注入的 `fs.writeFileSync` spy 观察到一次尝试），因为 `EACCES` /
`EROFS` / `EIO` 场景下诊断写入与 gate 创建可能同因失败。

### 6.2 真实文件系统并发测试

增加一个只测试 admission primitive 的跨进程 integration test：

1. 创建临时 state directory；
2. 同时启动 32 个 runtime process；
3. 所有进程对同一 bucket gate 执行相同 `wx` create；
4. 断言恰好一个成功、31 个得到 `EEXIST`；
5. 断言没有 shell quoting，临时路径包含空格；
6. 测试结束清理临时目录。

该测试必须进入 GitHub Actions 的 `ubuntu-latest`、`macos-latest`、
`windows-latest` 小矩阵。Windows job **只运行这个 admission-primitive 测试文件**
（vitest `-t` 或独立 config 隔离，不挂完整 L1）——Windows runner 单分钟成本高，
且我们不承诺完整 L1 在 Windows 下通过，只承诺 admission gate 的跨平台原子性。它
只验证本地文件系统 primitive，不启动真实 Pew sync，不会接触用户 HOME 或 Codex
配置。

### 6.3 回归测试

现有以下测试必须继续通过：

- `notify-handler.test.ts`
- `codex-notifier.test.ts`
- `notify-command.test.ts`
- `coordinator.test.ts`
- `coordinator-integration.test.ts`
- `init-command.test.ts`
- `uninstall-command.test.ts`

新增测试必须验证行为，不允许只用 `source.toContain(...)` 证明 containment。

## 七、跨平台与 Windows 基础支持

### 7.1 admission primitive

方案只依赖 Node 跨平台 API：

- `mkdirSync({ recursive: true })`
- `appendFileSync`
- `writeFileSync(..., { flag: "wx" })`
- `unlinkSync`
- `path.join` / `path.resolve`

`wx` 在本地 NTFS 上对应 exclusive create；Linux/macOS 本地文件系统也提供所需原子
语义。本轮明确以本地用户 state directory 为支持范围，不承诺 NFS/SMB 等网络文件
系统的 exclusive-create 一致性。

不要依赖：

- `flock` / `fcntl`；
- `/tmp`、`/usr/bin/env` 等 POSIX 路径；
- shell command string；
- chmod 是否生效；
- `process.kill(pid, 0)`；
- 大小写敏感路径。

Windows 上 cleanup 可能因杀毒软件或短暂 file handle 得到 `EPERM`。cleanup 是
best-effort，失败不得阻塞下一 bucket；测试应覆盖 `EPERM`。

### 7.2 当前 Codex command 的 Windows 阻塞项

当前 `buildNotifyCommand()` 固定生成：

```text
["/usr/bin/env", "node", notifyPath, "--source=codex"]
```

Windows 默认没有 `/usr/bin/env`。本轮改为安装时注入的 runtime executable，唯一
方式：

```text
[<resolved-runtime-path>, notifyPath, "--source=codex"]
```

`<resolved-runtime-path>` 的解析规则：

1. 默认使用 `process.execPath`，通过依赖注入传给 installer（不是在 handler 内部
   动态查询）；
2. 如果目标 runtime（Bun 或其他）证明不满足生成的 CJS handler 契约，安装时显式
   解析一个满足契约的 runtime path（例如通过 `which node` / `where.exe node`），
   仍由 installer 决定、写入 config；
3. **不引入运行时环境覆盖开关**（例如 `PEW_NOTIFY_NODE` 或类似 env）。逃生开关
   会新增一个"命令归属由环境决定"的语义，增加所有权判定、测试面和用户排障成本，
   而所有场景都可以通过 installer 的 DI 参数覆盖，测试通过注入 fake `execPath`
   即可全部覆盖。

所有 spawn 保持 argv array + `shell: false`；路径包含空格时不自行 quote。

迁移必须识别 legacy Pew command：

- install/status/uninstall 同时识别旧 `/usr/bin/env node` 和新 runtime command；
- 从 legacy 升级到新命令是 Pew-owned in-place migration；
- **不得**把 legacy Pew command 保存成 `codex_notify_original.json`，否则会人为
  制造 Pew self-backup。

实施前要用生成的 CJS handler 做 Node 与 Bun 双 runtime smoke test：`process.execPath`
在 npm 全局安装场景下指向 node；`bun add -g @nocoo/pew` 或 `bun x` 场景下可能指向
bun。如果 Bun 满足 CJS handler 契约，就沿用 `process.execPath`；不满足则由 installer
显式定位一个满足契约的 runtime，仍无 env override。

## 八、安装与卸载的最小 ownership 加固

runtime containment 是 P0；同时做两项低成本防止再次持久化明显错误状态：

1. 如果 `codex_notify_original.json` 已存在，而 top-level notify 当前不是任何已知的
   Pew-owned command，`pew init --source=codex` 返回 ownership conflict，不再静默
   接管；
2. uninstall 只有在 Codex driver 成功恢复/移除配置后才删除 original backup。
   driver skip、解析失败或写配置失败时保留 backup并返回明确警告。

首版只识别 Pew 自己的 legacy/current command，不尝试展开匿名第三方 wrapper。

## 九、实施文件与 TDD 顺序

预计修改：

| 文件 | 变更 |
|---|---|
| `packages/cli/src/notifier/notify-handler.ts` | 生成 self-contained handler main；chain guard；bucket gate；两个 spawn admission |
| `packages/cli/src/commands/notify.ts` | 支持短 `notBefore` debounce，再进入现有 coordinator |
| `packages/cli/src/notifier/codex-notifier.ts` | 跨平台 runtime command；legacy ownership recognition；conflict handling |
| `packages/cli/src/commands/uninstall.ts` | 仅在 Codex restore 成功后删除 original backup |
| `packages/cli/src/__tests__/notify-handler.test.ts` | VM 行为测试、spawn 上限、chain、gate error |
| `packages/cli/src/__tests__/codex-notifier.test.ts` | ownership conflict、legacy migration、Windows command |
| `packages/cli/src/__tests__/notify-command.test.ts` | deterministic debounce/notBefore tests |
| `packages/cli/src/__tests__/uninstall-command.test.ts` | restore 失败保留 backup |
| 新 integration test | 32-process `wx` admission，三平台 CI |
| `.github/workflows/ci.yml` | focused admission primitive OS matrix |

必须按 TDD 拆 commit：

| # | Commit | 内容 |
|---|---|---|
| 1 | `test(notifier): specify chain and bucket admission behavior` | VM L1 测试先红 |
| 2 | `fix(notifier): add pre-spawn chain and bucket containment` | handler 最小实现 |
| 3 | `test(notifier): cover debounced worker handoff` | notBefore / boundary / cleanup 测试先红 |
| 4 | `fix(notifier): coalesce admitted batch before sync` | worker 窗口末尾执行 |
| 5 | `test(codex): specify ownership and cross-platform command migration` | installer/uninstaller 测试先红 |
| 6 | `fix(codex): harden ownership and Windows runtime command` | installer/uninstaller 实现 |
| 7 | `test(notifier): verify exclusive admission across OS processes` | focused integration + CI matrix |
| 8 | `docs(45): mark notifier containment implemented` | 回填常量、commit、验证结果 |

每个实现 commit 都必须独立通过 G1；最终运行完整 L1/L2/G2，涉及真实 HOME 的测试
一律使用临时目录。

## 十、验收标准

### 10.1 必过

- 同 bucket 100 次并发调用：Pew worker = 1，Codex saved-original = 1（backup 存在）或 0（缺失/损坏）；
- `Pew → A → Pew` 且环境保留：第一次回入即零 spawn；
- 环境丢弃但立即回入：当前 bucket 零 spawn；
- gate 非 `EEXIST` 错误：**该 gate 对应 spawn = 0**（sync gate error → 无 Pew worker；
  forward gate error → 无 saved-original），另一 gate 独立参与竞争与判定；handler
  尝试写诊断（诊断本身 best-effort，不作为断言依据）；
- **fake-clock** 断言：worker 计算得到的 `delay = notBefore − now` 满足 `0 ≤ delay ≤ W`；
  不使用真实 wall-clock 做 CI gate，避免 CI runner 抖动导致 flaky。真实 wall-clock
  数据只在非阻塞 benchmark 报告，不参与 pass/fail 判定；
- Linux/macOS/Windows 的 32-process exclusive-create 均恰好一个 winner；
- Windows Codex command 不包含 `/usr/bin/env`，路径空格 smoke test 通过；
- legacy Pew command 升级不会写入 original backup；
- Codex restore 失败不会删除 original backup；
- 完整 `bun run lint`、`bun run test`、coverage、相关 integration 通过；
- 测试后 worktree 和用户 HOME 均无残留。

### 10.2 可量化资源上限

设 `W = ADMISSION_WINDOW_MS`：

- Pew worker 创建率 ≤ `1 / W`；
- Codex saved-original 调用率 ≤ `1 / W`；
- 同一 bucket child spawn 数 ≤ 2（一个 Pew worker + 最多一个 Codex saved-original）；
- 两个 gate 均为 loser 的 handler child spawn 数 = 0；
- chain re-entry child spawn 数 = 0；
- gate 正常残留数量目标 ≤ 4（`sync-<bucket>.lock` × 2 + `forward-codex-<bucket>.lock` × 2，
  跨相邻 bucket），崩溃残留由后续 worker 清理；
- 诊断文件固定为一个覆盖文件（`last-notify-guard.json`），且诊断写入本身是
  best-effort（写失败不改变 spawn 决策）。

### 10.3 已决项（review 结论）

- `ADMISSION_WINDOW_MS = 2_000`：接受。worker 是 detached，等 2 秒不阻塞 Codex，
  只影响后台数据新鲜度；2 秒比 500ms 更能限制环境丢失场景的创建率，且是 §4.4
  lost-wakeup 修复的正确性所需。
- saved-original 语义：**每 admission batch 最多一次**，理由见 §4.5（forwarding
  也必须走原子 gate，才能保证 loser 零 spawn）。不提供 `--forward-every-event`
  类逃生开关。
- 不引入 `MAX_HOPS`；仅保留 chain 长度 ≤ 2048 bytes 的 defense-in-depth 上界。
- Windows CI 只跑 admission-primitive 测试文件，不挂完整 L1（成本可接受）。
- 不引入运行时环境覆盖开关（例如 `PEW_NOTIFY_NODE`）。
- gate 拆两把：`sync-<bucket>.lock` 全 source 共享（每 bucket 一个 Pew worker），
  `forward-codex-<bucket>.lock` Codex 独占（每 bucket 一次 saved-original）。
  单一共享 gate 会让 Claude/Gemini 先到时静默吞掉 Codex 的 saved-original。

### 10.4 待确认（实施前）

1. 环境丢弃场景是否只做 rate containment（§4.6 现方案），还是首版就追加独立的
   bounded burst breaker（例如"10 秒内 > 3 个 admitted batches 阻断 60 秒"）；
2. `process.execPath` 在 npm Node 与 Bun 两种安装路径下是否都满足 CJS handler
   契约。实施前必须真跑 Bun smoke test；若失败则由 installer 显式解析一个满足
   契约的 runtime path（§7.2），仍不加 env override。

以上两项确认后进入实施；已决项不再重开。
