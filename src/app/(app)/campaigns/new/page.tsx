import { PageHeader } from '@/components/page-header'
import { CampaignForm } from '../campaign-form'

export default function NewCampaignPage() {
  return (
    <>
      <PageHeader
        title="New campaign"
        description="Each step is a goal, not a template — Claude writes the actual email per lead."
      />
      <CampaignForm />
    </>
  )
}
