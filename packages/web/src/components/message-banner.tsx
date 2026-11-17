import { Banner } from "@nocoo/basalt/components/banner";

export type MessageBannerMsg = { type: "success" | "error"; text: string };

interface MessageBannerProps {
  message: MessageBannerMsg | null;
  className?: string;
}

export function MessageBanner({ message, className }: MessageBannerProps) {
  if (!message) return null;
  return (
    <Banner
      variant={message.type === "error" ? "error" : "default"}
      size="sm"
      description={message.text}
      {...(className ? { className } : {})}
    />
  );
}
