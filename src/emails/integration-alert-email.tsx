import {
  Html,
  Head,
  Body,
  Container,
  Text,
  Heading,
  Hr,
  Section,
  Tailwind,
} from '@react-email/components';

interface IntegrationAlertEmailProps {
  subject: string;
  message: string;
}

export default function IntegrationAlertEmail({ subject, message }: IntegrationAlertEmailProps) {
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

            <Heading className="text-purple-950 text-xl font-extrabold text-center mb-4 mt-0">
              {subject}
            </Heading>

            <Text className="text-purple-800 text-base leading-relaxed mb-4 whitespace-pre-line">
              {message}
            </Text>

            <Hr className="border-solid border-purple-100 my-6" />

            <Text className="text-purple-400 text-xs text-center my-0">
              Sent by an Integration configured on your monitoring dashboard.
            </Text>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}
