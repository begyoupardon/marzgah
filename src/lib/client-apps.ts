/** Suggested VPN client apps per platform, shown on the customer page. */
export const CLIENT_APPS: Array<{
  platform: string
  apps: Array<{ name: string; url: string }>
}> = [
  {
    platform: 'اندروید',
    apps: [
      {
        name: 'v2rayNG',
        url: 'https://play.google.com/store/apps/details?id=com.v2ray.ang',
      },
      {
        name: 'Hiddify',
        url: 'https://github.com/hiddify/hiddify-app/releases',
      },
    ],
  },
  {
    platform: 'iOS',
    apps: [
      {
        name: 'Streisand',
        url: 'https://apps.apple.com/app/streisand/id6450534064',
      },
      {
        name: 'V2Box',
        url: 'https://apps.apple.com/app/v2box-v2ray-client/id6446814690',
      },
    ],
  },
  {
    platform: 'ویندوز / مک / لینوکس',
    apps: [
      {
        name: 'Hiddify',
        url: 'https://github.com/hiddify/hiddify-app/releases',
      },
      { name: 'v2rayN', url: 'https://github.com/2dust/v2rayN/releases' },
    ],
  },
]
