import {
  Html,
  Head,
  Body,
  Container,
  Text,
  Img,
  Button,
  Heading,
  Hr,
  Section,
  Tailwind,
} from '@react-email/components';
import { dashboardBaseUrl } from '@/lib/urls';

interface WelcomeEmailProps {
  name?: string;
  /** Instance's organisation name (Settings -> General), for "on <org>'s StayUp". */
  organizationName?: string;
}

export default function WelcomeEmail({ name, organizationName }: WelcomeEmailProps) {
  const userName = name || 'there';

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

            <Heading className="text-slate-900 text-2xl font-extrabold text-center mb-4 mt-0">
              Welcome to StayUp, {userName}! 👋
            </Heading>

            <Text className="text-slate-700 text-base leading-relaxed mb-4">
              An account has been created for you on{' '}
              {organizationName ? `${organizationName}'s` : 'this'} StayUp instance — the uptime
              monitoring, incident management and status pages for the services your team runs.
            </Text>

            <Text className="text-slate-700 text-base leading-relaxed mb-6">
              Sign in to see what's being monitored and what's currently up. If you're expected to
              take alerts, check that your notification integrations are connected before you're on
              call.
            </Text>

            <Section className="text-center mb-7">
              <Button
                href={`${dashboardBaseUrl()}/dashboard`}
                className="bg-emerald-600 text-white px-7 py-3 rounded-xl font-semibold text-sm no-underline inline-block shadow-md shadow-emerald-600/20"
              >
                Go to Dashboard &rarr;
              </Button>
            </Section>

            <Hr className="border-solid border-slate-200 my-6" />

            <Text className="text-slate-400 text-xs text-center my-0">
              You're receiving this because an administrator created an account for you.
            </Text>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}