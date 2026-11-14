import { Suspense } from 'react';
import { ChatbotSettings } from '@/components/chatbot-settings';
import { Spinner } from '@/components/ui';

export default function ChatbotPage() {
  return (
    <Suspense fallback={<div className="p-6"><Spinner /></div>}>
      <ChatbotSettings />
    </Suspense>
  );
}
