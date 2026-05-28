"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { ConfirmDialog } from "../../../components/shared/confirm-dialog";
import { SettingCard } from "../../../components/shared/setting-card";
import {
  getRiskCenter,
  updateGatewayNoticeSettings,
  updateGlobalCircuitBreakerSettings,
  updateRedisFailurePolicySettings,
  updateTemporaryIpNoticeBanSettings,
  type GatewayNoticeSettings,
  type GlobalCircuitBreakerSettings,
  type RedisFailurePolicySettings,
  type TemporaryIpNoticeBanSettings,
} from "../../../lib/api/settings";

const tempIpSchema = z.object({
  enabled: z.boolean(),
  threshold: z.coerce.number().int().min(2).max(20),
  windowSeconds: z.coerce.number().int().min(60).max(86400),
  banSeconds: z.coerce.number().int().min(60),
  message: z.string().trim().min(1),
});
const gatewaySchema = z.record(z.string(), z.string().trim().min(1));
const redisSchema = z.object({
  policy: z.enum(["fail-open", "fail-closed", "degraded"]),
  degradedAdminBypassEnabled: z.boolean(),
  degradedUserIdsText: z.string(),
  message: z.string().trim().min(1),
});
const circuitSchema = z.object({
  enabled: z.boolean(),
  allowAdmins: z.boolean(),
  allowedUserIdsText: z.string(),
  message: z.string().trim().min(1),
});

type TempIpInput = z.input<typeof tempIpSchema>;
type TempIpValues = z.output<typeof tempIpSchema>;
type GatewayValues = GatewayNoticeSettings;
type RedisInput = z.input<typeof redisSchema>;
type RedisValues = z.infer<typeof redisSchema>;
type CircuitInput = z.input<typeof circuitSchema>;
type CircuitValues = z.infer<typeof circuitSchema>;

const gatewayNoticeFields: Array<{
  key: keyof GatewayNoticeSettings;
  title: string;
  trigger: string;
  placeholders?: string;
}> = [
  {
    key: "userConcurrencyMessage",
    title: "用户并发限制",
    trigger: "当用户级并发数达到该用户的并发上限时返回。",
    placeholders: "{limit}=用户并发上限",
  },
  {
    key: "keyConcurrencyMessage",
    title: "API Key 并发限制",
    trigger: "当当前 API Key 的并发数达到该 Key 的并发上限时返回。",
    placeholders: "{limit}=Key 并发上限",
  },
  {
    key: "userRateLimitMessage",
    title: "用户每分钟速率限制",
    trigger: "当用户级每分钟请求数达到用户 RPM 上限时返回。",
    placeholders: "{limit}=用户 RPM；{seconds}=建议等待秒数",
  },
  {
    key: "keyRateLimitMessage",
    title: "API Key 每分钟速率限制",
    trigger: "当当前 API Key 每分钟请求数达到 Key RPM 上限时返回。",
    placeholders: "{limit}=Key RPM；{seconds}=建议等待秒数",
  },
  {
    key: "charityIpRateLimitMessage",
    title: "公益 IP 速率限制",
    trigger: "当公益模式开启 IP 维度限速，且客户端 IP 达到限制时返回。",
    placeholders: "{limit}=IP RPM；{seconds}=建议等待秒数",
  },
  {
    key: "modelUnavailableMessage",
    title: "模型不可用",
    trigger: "当路由不到可调用模型池/渠道，或目标模型当前不可用时返回。",
  },
  {
    key: "missingUsageMessage",
    title: "缺少 Usage 计费信息",
    trigger: "当上游响应缺少必要 usage 字段，网关无法完成计费时返回。",
  },
  {
    key: "staleResponsesContextMessage",
    title: "Responses 上下文过期",
    trigger: "当 Responses API 的上下文引用已失效或过期时返回。",
  },
  {
    key: "invalidEncryptedContentMessage",
    title: "加密内容无效",
    trigger: "当上游返回 encrypted_content 无效，无法继续处理上下文时返回。",
  },
];

export default function AdminRiskControlPage() {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState("");
  const [confirmAction, setConfirmAction] = useState<null | "redis" | "circuit">(null);
  const riskQuery = useQuery({ queryKey: ["admin", "risk-center"], queryFn: getRiskCenter });

  const tempForm = useForm<TempIpInput, unknown, TempIpValues>({ resolver: zodResolver(tempIpSchema) });
  const gatewayForm = useForm<GatewayValues>();
  const redisForm = useForm<RedisInput, unknown, RedisValues>({ resolver: zodResolver(redisSchema) });
  const circuitForm = useForm<CircuitInput, unknown, CircuitValues>({ resolver: zodResolver(circuitSchema) });

  useEffect(() => {
    const data = riskQuery.data;
    if (!data) return;
    tempForm.reset(data.temporaryIpNoticeBanSettings);
    gatewayForm.reset(data.gatewayNoticeSettings);
    redisForm.reset({
      ...data.redisFailurePolicySettings,
      degradedUserIdsText: data.redisFailurePolicySettings.degradedUserIds.join("\n"),
    });
    circuitForm.reset({
      ...data.globalCircuitBreakerSettings,
      allowedUserIdsText: data.globalCircuitBreakerSettings.allowedUserIds.join("\n"),
    });
  }, [circuitForm, gatewayForm, redisForm, riskQuery.data, tempForm]);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["admin", "risk-center"] });
  const tempMutation = useMutation({ mutationFn: updateTemporaryIpNoticeBanSettings, onSuccess: () => { setNotice("临时 IP 封禁规则已保存"); refresh(); }, onError: (error) => setNotice(errorToText(error)) });
  const gatewayMutation = useMutation({ mutationFn: updateGatewayNoticeSettings, onSuccess: () => { setNotice("网关提示文案已保存"); refresh(); }, onError: (error) => setNotice(errorToText(error)) });
  const redisMutation = useMutation({ mutationFn: updateRedisFailurePolicySettings, onSuccess: () => { setConfirmAction(null); setNotice("Redis 失败策略已保存"); refresh(); }, onError: (error) => setNotice(errorToText(error)) });
  const circuitMutation = useMutation({ mutationFn: updateGlobalCircuitBreakerSettings, onSuccess: () => { setConfirmAction(null); setNotice("全局熔断配置已保存"); refresh(); }, onError: (error) => setNotice(errorToText(error)) });

  const counters = riskQuery.data?.counters;

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm font-medium text-blue-700">Risk Control</p>
        <h2 className="mt-1 text-2xl font-semibold text-slate-950">风控与公告</h2>
        <p className="mt-2 text-sm text-slate-500">集中管理熔断、Redis 失败策略、网关提示和 IP 临时封禁。</p>
      </section>
      {notice ? <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-700">{notice}</div> : null}
      <section className="grid gap-4 md:grid-cols-4">
        <Metric label="PENDING 请求" value={counters?.pendingRequests ?? 0} />
        <Metric label="24h 失败" value={counters?.failedRequests24h ?? 0} />
        <Metric label="24h 网关提示" value={counters?.noticeRequests24h ?? 0} />
        <Metric label="24h 限流" value={counters?.rateLimitedRequests24h ?? 0} />
      </section>
      {riskQuery.isLoading ? <SkeletonGrid /> : (
        <section className="grid gap-5 xl:grid-cols-2">
          <SettingCard title="临时 IP 封禁规则" description="命中提示型封禁阈值后，临时阻断同一 IP。" form={tempForm} loading={tempMutation.isPending} onSubmit={(values) => tempMutation.mutate(values)}>
            <Toggle label="启用临时封禁" register={tempForm.register("enabled")} />
            <NumberField label="阈值" register={tempForm.register("threshold")} />
            <NumberField label="窗口秒数" register={tempForm.register("windowSeconds")} />
            <NumberField label="封禁秒数" register={tempForm.register("banSeconds")} />
            <TextArea label="提示文案" register={tempForm.register("message")} />
          </SettingCard>

          <SettingCard title="网关公告提示" description="每一项都说明什么时候触发，以及命中后返回给用户的文案内容。" form={gatewayForm} loading={gatewayMutation.isPending} onSubmit={(values) => gatewayMutation.mutate(values)}>
            {gatewayNoticeFields.map((field) => (
              <GatewayNoticeField
                key={field.key}
                title={field.title}
                trigger={field.trigger}
                placeholders={field.placeholders}
                register={gatewayForm.register(field.key)}
              />
            ))}
          </SettingCard>

          <SettingCard title="Redis 失败策略" description="从 fail-open 切换到 fail-closed 或 degraded 会改变请求放行策略，属于高危操作。" form={redisForm} loading={redisMutation.isPending} onSubmit={() => setConfirmAction("redis")}>
            <label className="grid gap-2"><span className={labelClass}>策略</span><select className={inputClass} {...redisForm.register("policy")}><option value="fail-open">fail-open</option><option value="fail-closed">fail-closed</option><option value="degraded">degraded</option></select></label>
            <Toggle label="降级时管理员绕过" register={redisForm.register("degradedAdminBypassEnabled")} />
            <TextArea label="降级白名单用户 ID，每行一个" register={redisForm.register("degradedUserIdsText")} />
            <TextArea label="失败提示" register={redisForm.register("message")} />
          </SettingCard>

          <SettingCard title="全局熔断配置" description="启用后会阻断普通 API 调用，请仅在紧急维护或故障隔离时使用。" form={circuitForm} loading={circuitMutation.isPending} onSubmit={() => setConfirmAction("circuit")}>
            <Toggle label="启用全局熔断" register={circuitForm.register("enabled")} />
            <Toggle label="允许管理员调用" register={circuitForm.register("allowAdmins")} />
            <TextArea label="允许用户 ID，每行一个" register={circuitForm.register("allowedUserIdsText")} />
            <TextArea label="熔断提示" register={circuitForm.register("message")} />
          </SettingCard>
        </section>
      )}
      <ConfirmDialog open={Boolean(confirmAction)} title="确认高危配置变更" description={confirmAction === "circuit" ? "全局熔断启用后会阻断普通 API 调用。请确认你了解影响范围。" : "Redis 失败策略切换为 fail-closed 或 degraded 可能阻断或限制请求。"} confirmText="确认保存" requireInputText="确认保存" loading={redisMutation.isPending || circuitMutation.isPending} onOpenChange={(open) => !open && setConfirmAction(null)} onConfirm={async () => {
        if (confirmAction === "redis") {
          const values = redisForm.getValues();
          await redisMutation.mutateAsync({ policy: values.policy, degradedAdminBypassEnabled: values.degradedAdminBypassEnabled, degradedUserIds: lines(values.degradedUserIdsText), message: values.message });
        }
        if (confirmAction === "circuit") {
          const values = circuitForm.getValues();
          await circuitMutation.mutateAsync({ enabled: values.enabled, allowAdmins: values.allowAdmins, allowedUserIds: lines(values.allowedUserIdsText), message: values.message });
        }
      }} />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) { return <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm text-slate-500">{label}</p><p className="mt-2 text-2xl font-semibold tabular-nums text-slate-950">{value.toLocaleString("en-US")}</p></div>; }
function NumberField({ label, register }: { label: string; register: object }) { return <label className="grid gap-2"><span className={labelClass}>{label}</span><input type="number" className={inputClass} {...register} /></label>; }
function TextArea({ label, register }: { label: string; register: object }) { return <label className="grid gap-2"><span className={labelClass}>{label}</span><textarea rows={3} className={textareaClass} {...register} /></label>; }
function GatewayNoticeField({ title, trigger, placeholders, register }: { title: string; trigger: string; placeholders?: string; register: object }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="grid gap-1">
        <div className="text-sm font-semibold text-slate-950">触发时机：{title}</div>
        <p className="text-sm leading-6 text-slate-500">{trigger}</p>
        {placeholders ? <p className="text-xs font-medium text-blue-700">可用变量：{placeholders}</p> : null}
      </div>
      <label className="mt-3 grid gap-2">
        <span className={labelClass}>返回内容</span>
        <textarea rows={3} className={textareaClass} {...register} />
      </label>
    </div>
  );
}
function Toggle({ label, register }: { label: string; register: object }) { return <label className="flex h-10 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700"><input type="checkbox" className="h-4 w-4 rounded border-slate-300" {...register} />{label}</label>; }
function SkeletonGrid() { return <div className="grid gap-5 xl:grid-cols-2">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-80 animate-pulse rounded-lg bg-slate-100" />)}</div>; }
function lines(value: string) { return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean); }
function errorToText(error: unknown) { return error instanceof Error ? error.message : "操作失败，请稍后重试。"; }
const labelClass = "text-sm font-medium text-slate-700";
const inputClass = "h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
const textareaClass = "w-full resize-y rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
