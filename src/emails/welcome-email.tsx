import {
  Body, Button, Container, Head, Heading, Hr, Html, Preview, Section, Text,
} from "@react-email/components";

export function WelcomeEmail({
  audience, displayName, shopName, appUrl,
}: {
  audience: "buyer" | "seller";
  displayName: string;
  shopName?: string | null;
  appUrl: string;
}) {
  const isSeller = audience === "seller";
  const heading = isSeller ? "Welcome to MaliHub as a seller" : "Welcome to MaliHub Kenya";
  const preview = isSeller ? "Your MaliHub seller journey starts here." : "Your next great find is waiting on MaliHub.";
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ backgroundColor: "#0a0a0a", fontFamily: "Arial, Helvetica, sans-serif", margin: 0, padding: "28px 12px" }}>
        <Container style={{ backgroundColor: "#111111", border: "1px solid #302719", borderRadius: "16px", maxWidth: "560px", padding: "36px 32px" }}>
          <Text style={{ color: "#d6b56e", fontSize: "12px", fontWeight: 700, letterSpacing: "3px", margin: "0 0 24px" }}>MALIHUB KENYA</Text>
          <Heading style={{ color: "#f5f0e6", fontSize: "27px", fontWeight: 600, lineHeight: 1.25, margin: "0 0 18px" }}>{heading}</Heading>
          <Text style={{ color: "#e5dfd3", fontSize: "15px", lineHeight: 1.7, margin: "0 0 14px" }}>Hello {displayName || "there"},</Text>
          {isSeller ? (
            <>
              <Text style={{ color: "#c8c0b3", fontSize: "15px", lineHeight: 1.7 }}>Thank you for joining MaliHub as a seller{shopName ? " with " + shopName : ""}. Your seller account has been created. Please complete email verification before signing in to manage your shop.</Text>
              <Text style={{ color: "#c8c0b3", fontSize: "15px", lineHeight: 1.7 }}>Once signed in, you can prepare product listings, manage orders and follow the fulfilment steps in Seller Center. Seller verification and listing approval remain separate steps where applicable.</Text>
            </>
          ) : (
            <>
              <Text style={{ color: "#c8c0b3", fontSize: "15px", lineHeight: 1.7 }}>We’re glad you’re here. MaliHub brings buyers and independent Kenyan sellers together, making it easier to discover products and shop from local businesses.</Text>
              <Text style={{ color: "#c8c0b3", fontSize: "15px", lineHeight: 1.7 }}>Browse products, manage your orders and follow delivery updates from your buyer account. You can also explore the marketplace before placing your first order.</Text>
            </>
          )}
          <Section style={{ margin: "28px 0" }}>
            <Button href={isSeller ? `${appUrl}/verify-email` : appUrl} style={{ backgroundColor: "#b8934a", borderRadius: "999px", color: "#0a0a0a", display: "inline-block", fontSize: "14px", fontWeight: 700, padding: "13px 22px", textDecoration: "none" }}>{isSeller ? "Continue to email verification" : "Explore MaliHub"}</Button>
          </Section>
          <Hr style={{ borderColor: "#302719", margin: "24px 0" }} />
          <Text style={{ color: "#918879", fontSize: "12px", lineHeight: 1.6, margin: 0 }}>Thank you for choosing MaliHub Kenya. If you did not create this account, you can ignore this email.</Text>
          <Text style={{ color: "#d6b56e", fontSize: "12px", fontWeight: 600, margin: "18px 0 0" }}>The MaliHub Kenya Team</Text>
        </Container>
      </Body>
    </Html>
  );
}