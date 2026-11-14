import { Suspense } from 'react';
import { CompanySettingsView } from '@/components/company-settings';
import { Spinner } from '@/components/ui';

export default function CompanySettingsPage() {
  return (
    <Suspense fallback={<div className="p-6"><Spinner /></div>}>
      <CompanySettingsView />
    </Suspense>
  );
}
