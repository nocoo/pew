import { Banner } from "@nocoo/basalt/components/banner";

interface ErrorBannerProps {
  messagePrefix: string;
  error: string | null | undefined;
}

export function ErrorBanner({ messagePrefix, error }: ErrorBannerProps) {
  if (!error) return null;
  return <Banner variant="error" size="sm" description={`${messagePrefix}: ${error}`} />;
}
