import { z } from 'zod'

import { providers } from '~/types/deploy.js'

export const DeployOptionsSchema = z.object({
  provider: z.enum(providers).default('railway'),
})

export type DeployOptions = z.infer<typeof DeployOptionsSchema>
