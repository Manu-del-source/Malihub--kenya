import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";

export function NotificationEmail({
  heading,
  body,
  ctaLabel,
  ctaUrl,
}: {
  heading: string;
  body: string;
  ctaLabel?: string;
  ctaUrl?: string;
}) {
  return (
    <Html>
      <Head />
      <Preview>{heading}</Preview>
      <Body style={{ backgroundColor: "#f4f2ef", fontFamily: "Helvetica, Arial, sans-serif" }}>
        <Container
          style={{
            backgroundColor: "#ffffff",
            borderRadius: "16px",
            padding: "40px",
            maxWidth: "480px",
            margin: "40px auto",
          }}
        >
          <Text style={{ fontSize: "13px", color: "#d97706", fontWeight: 600, letterSpacing: "0.05em" }}>
            MALIHUB KENYA
          </Text>
          <Heading style={{ fontSize: "22px", color: "#1c1508", margin: "12px 0" }}>{heading}</Heading>
          <Text style={{ fontSize: "15px", color: "#4b4536", lineHeight: "1.6" }}>{body}</Text>
          {ctaLabel && ctaUrl && (
            <Section style={{ marginTop: "24px" }}>
              <Button
                href={ctaUrl}
                style={{
                  backgroundColor: "#d97706",
                  color: "#ffffff",
                  borderRadius: "999px",
                  padding: "12px 24px",
                  fontSize: "14px",
                  fontWeight: 600,
                  textDecoration: "none",
                }}
              >
                {ctaLabel}
              </Button>
            </Section>
          )}
        </Container>
      </Body>
    </Html>
  );
}
