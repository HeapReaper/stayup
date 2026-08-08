import {
  Html,
  Head,
  Body,
  Container,
  Text,
  Button,
  Heading,
  Hr,
  Section,
  Tailwind,
} from "@react-email/components";

interface WelcomeEmailProps {
  name?: string;
}

export default function WelcomeEmail({ name }: WelcomeEmailProps) {
  const userName = name || "there";

  return (
    <Html>
      <Head />
      <Tailwind>
        <Body className="bg-purple-50 font-sans my-0 py-10">
          <Container className="mx-auto my-0 p-8 bg-white rounded-2xl border border-solid border-purple-100 max-w-[480px] shadow-sm">
            <Section className="text-center mb-6">
              <div className="inline-block w-10 h-10 bg-purple-600 rounded-xl text-white font-bold text-xl leading-10 text-center">
                N
              </div>
              <Text className="text-lg font-bold text-purple-950 mt-2 mb-0">
                Next<span className="text-purple-600">Temp</span>
              </Text>
            </Section>

            <Heading className="text-purple-950 text-2xl font-extrabold text-center mb-4 mt-0">
              Welcome to NextTemp, {userName}! 👋
            </Heading>

            <Text className="text-purple-800 text-base leading-relaxed mb-4">
              Thanks for joining! Your account has been created successfully.
              NextTemp gives you a fast, type-safe Next.js stack so you can build
              and deploy your next big project without friction.
            </Text>

            <Text className="text-purple-800 text-base leading-relaxed mb-6">
              You can now log in to your dashboard to manage your session and explore all features.
            </Text>

            <Section className="text-center mb-7">
              <Button
                href="http://localhost:3000/dashboard"
                className="bg-purple-600 text-white px-7 py-3 rounded-xl font-semibold text-sm no-underline inline-block shadow-md shadow-purple-600/20"
              >
                Go to Dashboard &rarr;
              </Button>
            </Section>

            <Hr className="border-solid border-purple-100 my-6" />

            <Text className="text-purple-400 text-xs text-center my-0">
              Made with 💜 by NextTemp. If you have any questions, reply to this email.
            </Text>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}