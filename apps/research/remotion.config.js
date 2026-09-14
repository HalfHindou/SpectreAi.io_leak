/**
 * Remotion Configuration
 * Config for Remotion CLI and Studio
 */
import { Config } from '@remotion/cli/config'

Config.setVideoImageFormat('jpeg')
Config.setOverwriteOutput(true)
Config.setConcurrency(4)

// Output directory for rendered videos
Config.setOutputLocation('./public/videos')
