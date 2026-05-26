"use client";

import { computed, createApp, h, onBeforeUnmount, onMounted, ref, type App as VueApp } from "vue";
import { useEffect, useRef } from "react";

type CharityDashboard = {
  generatedAt: string;
  gateway?: string;
  charityKey?: string | null;
  announcement?: {
    enabled: boolean;
    frequency: "every_visit" | "interval";
    intervalHours: number;
    title: string;
    content: string;
  };
  totals: {
    charityUsers: number;
    requests: number;
    successRequests: number;
    failedRequests: number;
    successRate: number;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    totalTokens: number;
    chargedAmountUsd: string;
    upstreamCostUsd: string;
  };
  trend30d: Array<{
    date: string;
    requests: number;
    totalTokens: number;
    chargedAmountUsd: string;
  }>;
  ranking: Array<{
    name: string;
    requests: number;
    successRate: number;
    totalTokens: number;
    chargedAmountUsd: string;
  }>;
  models: Array<{
    model: string;
    requests: number;
    successRate: number;
    totalTokens: number;
    chargedAmountUsd: string;
  }>;
};

export default function CharityVueApp({ data }: { data: CharityDashboard | null }) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<VueApp<Element> | null>(null);

  useEffect(() => {
    if (!mountRef.current) {
      return;
    }

    const vueApp = createApp({
      setup() {
        const payload = data;
        const totals = payload?.totals ?? {
          charityUsers: 0,
          requests: 0,
          successRequests: 0,
          failedRequests: 0,
          successRate: 0,
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          chargedAmountUsd: "0",
          upstreamCostUsd: "0",
        };
        const trend = payload?.trend30d ?? [];
        const today = computed(() => trend.at(-1));
        const yesterday = computed(() => trend.at(-2));
        const maxTokens = Math.max(1, ...trend.map((item) => item.totalTokens));
        const maxRequests = Math.max(1, ...trend.map((item) => item.requests));
        const gateway = payload?.gateway ?? "https://free.l-kx.cn";
        const charityKey = payload?.charityKey ?? "未填写公益 Key";
        const apiBaseUrl = `${gateway.replace(/\/+$/, "")}/v1`;
        const serviceAvailable = ref(false);
        const statusLoaded = ref(false);
        const showAnnouncement = ref(false);
        const announcement = payload?.announcement;
        const displayModels = ["gpt-5.5"];

        const currency = (value: string) => `$${Number(value).toFixed(2)}`;
        const compact = (value: number) =>
          new Intl.NumberFormat("en-US", {
            notation: "compact",
            maximumFractionDigits: 1,
          }).format(value);
        const int = (value: number) => new Intl.NumberFormat("zh-CN").format(value);
        const sparkPoints = (value: number, max: number, index: number) => {
          const width = 100 / Math.max(1, trend.length - 1);
          const x = index * width;
          const y = 100 - (value / Math.max(1, max)) * 100;
          return `${x},${y}`;
        };
        let statusSource: EventSource | null = null;

        onMounted(async () => {
          showAnnouncement.value = shouldShowAnnouncement(announcement);

          try {
            const response = await fetch("/public/charity-status", {
              cache: "no-store",
            });
            if (response.ok) {
              const status = (await response.json()) as { available?: boolean };
              serviceAvailable.value = Boolean(status.available);
              statusLoaded.value = true;
            }
          } catch {
            statusLoaded.value = true;
            serviceAvailable.value = false;
          }

          statusSource = new EventSource("/public/charity-status/events");
          statusSource.addEventListener("status", (event) => {
            const status = JSON.parse((event as MessageEvent).data) as {
              available?: boolean;
            };
            serviceAvailable.value = Boolean(status.available);
            statusLoaded.value = true;
          });
          statusSource.addEventListener("error", () => {
            statusLoaded.value = true;
          });
        });

        onBeforeUnmount(() => {
          statusSource?.close();
          statusSource = null;
        });

        return () =>
          h("main", { class: "charity-vue-page" }, [
            showAnnouncement.value && announcement?.enabled
              ? h("div", { class: "charity-announcement-backdrop" }, [
                  h("section", { class: "charity-announcement-modal" }, [
                    h("div", { class: "announcement-orbit" }),
                    h("div", { class: "charity-announcement-kicker" }, "APIshare 公益"),
                    h("h2", announcement.title || "公益 API 使用公告"),
                    h("p", announcement.content || "请合理使用公益 API 资源。"),
                    h("button", {
                      class: "announcement-primary-button",
                      onClick: () => dismissAnnouncement(announcement),
                      type: "button",
                    }, "我知道了"),
                  ]),
                ])
              : null,
            h("section", { class: "charity-vue-hero" }, [
              h("div", { class: "charity-vue-title" }, [
                h("span", { class: "hero-kicker" }, "Public AI Gateway"),
                h("h1", "APIshare公益"),
                h("p", "永久免费公益API"),
              ]),
            ]),
            h("section", { class: "charity-vue-info-grid" }, [
              h("article", { class: "content-panel quick-start" }, [
                h("div", { class: "section-head compact" }, [h("h2", "快速使用")]),
                h("div", { class: "usage-lines" }, [
                  usageLine("Base URL", apiBaseUrl),
                  usageLine("API Key", charityKey),
                ]),
              ]),
              h("article", { class: "content-panel service-panel service-panel-minimal" }, [
                h("div", { class: "section-head compact" }, [h("h2", "服务状态")]),
                h(
                  "div",
                  {
                    class: statusLoaded.value
                      ? serviceAvailable.value
                        ? "status-row ok"
                        : "status-row down"
                      : "status-row checking",
                  },
                  [
                    h("span"),
                    h(
                      "strong",
                      statusLoaded.value
                        ? serviceAvailable.value
                          ? "可用"
                          : "不可用"
                        : "检测中",
                    ),
                  ],
                ),
              ]),
            ]),
            h("section", { class: "model-rules-grid" }, [
              h("article", { class: "content-panel model-card" }, [
                h("div", { class: "section-head compact" }, [h("h2", "可用模型")]),
                h("div", { class: "model-focus" }, displayModels.map((model) => h("span", model))),
              ]),
              h("article", { class: "content-panel rules-card" }, [
                h("div", { class: "section-head compact" }, [h("h2", "使用规则")]),
                h("ul", { class: "rule-list" }, [
                  h("li", "永久免费公益使用，不承诺商业 SLA。"),
                  h("li", "禁止批量滥用、倒卖、攻击和违法用途。"),
                  h("li", "公益 Key 会不定期轮换，旧 Key 会失效。"),
                  h("li", "服务可能按负载进行限流，请合理调用。"),
                ]),
              ]),
            ]),
            h("section", { class: "charity-vue-grid" }, [
              metricCard("总统计", [
                metricItem("总请求", int(totals.requests)),
                metricItem("总 Token", compact(totals.totalTokens)),
                metricItem("总费用", currency(totals.chargedAmountUsd)),
              ]),
              metricCard("每日统计", [
                metricItem("今日请求", int(today.value?.requests ?? 0)),
                metricItem("今日 Token", compact(today.value?.totalTokens ?? 0)),
                metricItem("今日费用", currency(today.value?.chargedAmountUsd ?? "0")),
              ]),
            ]),
            h("section", { class: "charity-vue-chart" }, [
              h("div", { class: "section-head" }, [
                h("div", null, [h("h2", "RPM / TPM 趋势"), h("p", "按天动态聚合")]),
                h("div", { class: "range-pill" }, "30D"),
              ]),
              h("svg", { viewBox: "0 0 100 100", preserveAspectRatio: "none" }, [
                h("polyline", {
                  class: "line rpm",
                  points: trend.map((item, index) => sparkPoints(item.requests, maxRequests, index)).join(" "),
                }),
                h("polyline", {
                  class: "line tpm",
                  points: trend.map((item, index) => sparkPoints(item.totalTokens, maxTokens, index)).join(" "),
                }),
              ]),
              h("div", { class: "chart-legend" }, [
                h("span", { class: "legend rpm" }, "RPM"),
                h("span", { class: "legend tpm" }, "TPM"),
              ]),
            ]),
          ]);

        function metricCard(title: string, items: any[]) {
          return h("article", { class: "metric-card" }, [
            h("div", { class: "section-head compact" }, [h("h2", title)]),
            h("div", { class: items.length === 3 ? "metric-grid three" : "metric-grid" }, items),
          ]);
        }

        function metricItem(label: string, value: string) {
          return h("div", { class: "metric-item" }, [h("span", label), h("strong", value)]);
        }

        function usageLine(label: string, value: string) {
          return h("div", null, [
            h("span", label),
            h("div", { class: "usage-value" }, [
              h("code", value),
              h(
                "button",
                {
                  "aria-label": `复制${label}`,
                  class: "copy-icon-button",
                  onClick: () => copyText(value),
                  title: `复制${label}`,
                  type: "button",
                },
                [
                  h(
                    "svg",
                    {
                      "aria-hidden": "true",
                      fill: "none",
                      height: "18",
                      stroke: "currentColor",
                      "stroke-linecap": "round",
                      "stroke-linejoin": "round",
                      "stroke-width": "2",
                      viewBox: "0 0 24 24",
                      width: "18",
                    },
                    [
                      h("rect", { height: "14", rx: "2", ry: "2", width: "14", x: "8", y: "8" }),
                      h("path", { d: "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" }),
                    ],
                  ),
                ],
              ),
            ]),
          ]);
        }

        async function copyText(value: string) {
          await navigator.clipboard?.writeText(value);
        }

        function shouldShowAnnouncement(
          settings: CharityDashboard["announcement"] | undefined,
        ) {
          if (!settings?.enabled || !settings.content.trim()) {
            return false;
          }
          if (settings.frequency === "every_visit") {
            return true;
          }
          const lastShownAt = Number(
            window.localStorage.getItem("charity-announcement-last-shown-at") ?? "0",
          );
          const intervalMs = Math.max(1, settings.intervalHours) * 60 * 60 * 1000;
          return Date.now() - lastShownAt >= intervalMs;
        }

        function dismissAnnouncement(
          settings: CharityDashboard["announcement"],
        ) {
          if (settings?.frequency === "interval") {
            window.localStorage.setItem(
              "charity-announcement-last-shown-at",
              String(Date.now()),
            );
          }
          showAnnouncement.value = false;
        }

      },
    });

    vueApp.mount(mountRef.current);
    appRef.current = vueApp;

    return () => {
      appRef.current?.unmount();
      appRef.current = null;
    };
  }, [data]);

  return <div ref={mountRef} className="charity-vue-root" />;
}
