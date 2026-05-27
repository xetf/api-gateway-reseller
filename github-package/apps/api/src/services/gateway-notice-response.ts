import type { FastifyReply } from "fastify";
import {
  isResponsesEndpoint,
  requestAsksForStream,
  type ProxyBody,
} from "./proxy-request-utils.js";

type NoticeResponse = {
  id: string;
  object: "response";
  created_at: number;
  status: "completed";
  background: false;
  completed_at: number;
  error: null;
  incomplete_details: null;
  model: string;
  output: [
    {
      id: string;
      type: "message";
      status: "completed";
      role: "assistant";
      content: [
        {
          type: "output_text";
          text: string;
          annotations: unknown[];
        },
      ];
    },
  ];
  output_text: string;
  usage: ReturnType<typeof zeroResponseUsage>;
};

export function sendApiKeyNotice(
  reply: FastifyReply,
  endpoint: string,
  body: ProxyBody,
  requestUrl: string,
  noticeText: string,
  acceptHeader?: string | string[],
) {
  const notice = noticeText.trim();
  const model =
    typeof body.model === "string" && body.model.trim()
      ? body.model
      : "gateway-notice";
  const accept = Array.isArray(acceptHeader)
    ? acceptHeader.join(",")
    : (acceptHeader ?? "");

  reply.status(200);
  reply.header("x-gateway-notice", "true");
  reply.header("cache-control", "no-store");

  if (
    requestAsksForStream(body, requestUrl) ||
    accept.includes("text/event-stream")
  ) {
    reply.header("content-type", "text/event-stream; charset=utf-8");
    return reply.send(buildNoticeStream(endpoint, model, notice));
  }

  reply.header("content-type", "application/json; charset=utf-8");

  if (endpoint === "/v1/chat/completions") {
    return reply.send(buildNoticeChatCompletion(model, notice));
  }

  if (endpoint === "/v1/completions") {
    return reply.send(buildNoticeCompletion(model, notice));
  }

  if (isResponsesEndpoint(endpoint)) {
    return reply.send(buildNoticeResponse(model, notice));
  }

  return reply.send({
    id: createNoticeId("notice"),
    object: "gateway.notice",
    created: Math.floor(Date.now() / 1000),
    model,
    notice,
    output_text: notice,
    usage: zeroTokenUsage(),
  });
}

export function buildNoticeStream(
  endpoint: string,
  model: string,
  notice: string,
) {
  if (endpoint === "/v1/chat/completions") {
    const created = Math.floor(Date.now() / 1000);
    const id = createNoticeId("chatcmpl");
    return [
      sseData({
        id,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [
          {
            index: 0,
            delta: {
              role: "assistant",
            },
            finish_reason: null,
          },
        ],
      }),
      sseData({
        id,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [
          {
            index: 0,
            delta: {
              content: notice,
            },
            finish_reason: null,
          },
        ],
      }),
      sseData({
        id,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [
          {
            index: 0,
            delta: {
              content: "",
            },
            finish_reason: "stop",
          },
        ],
      }),
      sseData({
        id,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [],
        usage: zeroTokenUsage(),
      }),
      "data: [DONE]\n\n",
    ].join("");
  }

  if (endpoint === "/v1/completions") {
    const created = Math.floor(Date.now() / 1000);
    const id = createNoticeId("cmpl");
    return [
      sseData({
        id,
        object: "text_completion",
        created,
        model,
        choices: [
          {
            text: notice,
            index: 0,
            logprobs: null,
            finish_reason: null,
          },
        ],
        delta: notice,
      }),
      sseData({
        id,
        object: "text_completion",
        created,
        model,
        choices: [],
        usage: zeroTokenUsage(),
      }),
      "data: [DONE]\n\n",
    ].join("");
  }

  if (isResponsesEndpoint(endpoint)) {
    const response = buildNoticeResponse(model, notice);
    const outputItem = response.output[0];
    const contentPart = outputItem.content[0];
    const inProgressResponse = {
      ...response,
      status: "in_progress",
      completed_at: null,
      output: [],
      output_text: "",
      usage: null,
    };
    const completedStreamResponse = {
      ...response,
      output: [],
    };

    return [
      sseEvent("response.created", {
        type: "response.created",
        response: inProgressResponse,
        sequence_number: 0,
      }),
      sseEvent("response.in_progress", {
        type: "response.in_progress",
        response: inProgressResponse,
        sequence_number: 1,
      }),
      sseEvent("response.output_item.added", {
        type: "response.output_item.added",
        output_index: 0,
        item: {
          ...outputItem,
          status: "in_progress",
          content: [],
        },
        sequence_number: 2,
      }),
      sseEvent("response.content_part.added", {
        type: "response.content_part.added",
        item_id: outputItem.id,
        output_index: 0,
        content_index: 0,
        part: {
          ...contentPart,
          text: "",
        },
        sequence_number: 3,
      }),
      sseEvent("response.output_text.delta", {
        type: "response.output_text.delta",
        item_id: outputItem.id,
        output_index: 0,
        content_index: 0,
        delta: notice,
        sequence_number: 4,
      }),
      sseEvent("response.output_text.done", {
        type: "response.output_text.done",
        item_id: outputItem.id,
        output_index: 0,
        content_index: 0,
        text: notice,
        sequence_number: 5,
      }),
      sseEvent("response.content_part.done", {
        type: "response.content_part.done",
        item_id: outputItem.id,
        output_index: 0,
        content_index: 0,
        part: contentPart,
        sequence_number: 6,
      }),
      sseEvent("response.output_item.done", {
        type: "response.output_item.done",
        output_index: 0,
        item: outputItem,
        sequence_number: 7,
      }),
      sseEvent("response.completed", {
        type: "response.completed",
        response: completedStreamResponse,
        sequence_number: 8,
      }),
      "data: [DONE]\n\n",
    ].join("");
  }

  return [
    sseData({
      id: createNoticeId("notice"),
      object: "gateway.notice.chunk",
      model,
      delta: notice,
      output_text: notice,
      notice,
      usage: zeroTokenUsage(),
    }),
    "data: [DONE]\n\n",
  ].join("");
}

export function buildStreamErrorEvent(message: string, statusCode: number) {
  return [
    sseEvent("error", {
      error: {
        message,
        type: statusCode === 504 ? "timeout_error" : "upstream_error",
        code: statusCode,
      },
    }),
    "data: [DONE]\n\n",
  ].join("");
}

function buildNoticeChatCompletion(model: string, notice: string) {
  return {
    id: createNoticeId("chatcmpl"),
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: notice,
        },
        finish_reason: "stop",
      },
    ],
    usage: zeroTokenUsage(),
  };
}

function buildNoticeCompletion(model: string, notice: string) {
  return {
    id: createNoticeId("cmpl"),
    object: "text_completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        text: notice,
        index: 0,
        logprobs: null,
        finish_reason: "stop",
      },
    ],
    usage: zeroTokenUsage(),
  };
}

function buildNoticeResponse(model: string, notice: string): NoticeResponse {
  const messageId = createNoticeId("msg");
  return {
    id: createNoticeId("resp"),
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status: "completed",
    background: false,
    completed_at: Math.floor(Date.now() / 1000),
    error: null,
    incomplete_details: null,
    model,
    output: [
      {
        id: messageId,
        type: "message",
        status: "completed",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: notice,
            annotations: [],
          },
        ],
      },
    ],
    output_text: notice,
    usage: zeroResponseUsage(),
  };
}

function zeroTokenUsage() {
  return {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  };
}

function zeroResponseUsage() {
  return {
    input_tokens: 0,
    input_tokens_details: {
      cached_tokens: 0,
    },
    output_tokens: 0,
    output_tokens_details: {
      reasoning_tokens: 0,
    },
    total_tokens: 0,
  };
}

function createNoticeId(prefix: string) {
  return `${prefix}_notice_${Date.now().toString(36)}`;
}

function sseData(value: unknown) {
  return `data: ${JSON.stringify(value)}\n\n`;
}

function sseEvent(event: string, value: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(value)}\n\n`;
}
