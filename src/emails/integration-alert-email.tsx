import {
  Html,
  Head,
  Body,
  Container,
  Text,
  Img,
  Heading,
  Hr,
  Section,
  Tailwind,
} from '@react-email/components';
import { dashboardBaseUrl } from '@/lib/urls';

interface IntegrationAlertEmailProps {
  subject: string;
  message: string;
}

export default function IntegrationAlertEmail({ subject, message }: IntegrationAlertEmailProps) {
  return (
    <Html>
      <Head />
      <Tailwind>
        <Body className="bg-slate-50 font-sans my-0 py-10">
          <Container className="mx-auto my-0 p-8 bg-white rounded-2xl border border-solid border-slate-200 max-w-[480px] shadow-sm">
            <Section className="text-center mb-6">
              <Img
                src={`${dashboardBaseUrl()}/icon-192.png`}
                width="40"
                height="40"
                alt=""
                className="inline-block rounded-xl"
              />
              <Text className="text-lg font-bold text-slate-900 mt-2 mb-0">
                Stay<span className="text-emerald-600">Up</span>
              </Text>
            </Section>

            <Heading className="text-slate-900 text-xl font-extrabold text-center mb-4 mt-0">
              {subject}
            </Heading>

            <Text className="text-slate-700 text-base leading-relaxed mb-4 whitespace-pre-line">
              {message}
            </Text>

            <Hr className="border-solid border-slate-200 my-6" />

            <Text className="text-slate-400 text-xs text-center my-0">
              Sent by an Integration configured on your monitoring dashboard.
            </Text>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}
