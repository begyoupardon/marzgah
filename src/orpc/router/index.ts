import {
  createReseller,
  listResellers,
  marzbanHealth,
  updateReseller,
} from './admin'
import { listAuditLogs } from './audit'
import {
  adminBillingSummary,
  claimBillingPaid,
  listOutstandingBilling,
  myBillingSummary,
  settleBillingEvent,
  unsettleBillingEvent,
} from './billing'
import { getDashboard, getMe } from './dashboard'
import {
  getTelegramAdmin,
  adminUnlinkTelegram,
  outboxStats,
  registerTelegramWebhook,
  saveTelegramAdmin,
  telegramLinkedAccounts,
  sendTestMessage,
  startTelegramLink,
  telegramStatus,
  unlinkMyTelegram,
} from './notifications'
import {
  approveRenewalRequest,
  createCustomerLink,
  getBranding,
  listRenewalRequests,
  publicRequestRenewal,
  publicView,
  rejectRenewalRequest,
  revokeCustomerLink,
  setBranding,
} from './customer'
import {
  bulkLabel,
  bulkRenew,
  exportBilling,
  exportUsers,
  getAnnouncement,
  getAnnouncementAdmin,
  importUsers,
  resumeResellerAccount,
  setAnnouncement,
  setResellerLimits,
  suspendResellerAccount,
  updateUserContact,
} from './seller-tools'
import {
  adjustWallet,
  myWallet,
  resellerWallet,
  setBalance,
  setCreditLimit,
} from './wallet'
import {
  createVpnUser,
  deleteVpnUser,
  listVpnUsers,
  renewVpnUser,
  resetVpnUserUsage,
  revokeVpnUserSub,
  syncVpnUser,
  updateVpnUser,
} from './vpn-users'

export const router = {
  me: getMe,
  dashboard: getDashboard,
  admin: {
    listResellers,
    createReseller,
    updateReseller,
    marzbanHealth,
  },
  vpnUsers: {
    list: listVpnUsers,
    create: createVpnUser,
    update: updateVpnUser,
    renew: renewVpnUser,
    delete: deleteVpnUser,
    resetUsage: resetVpnUserUsage,
    revokeSub: revokeVpnUserSub,
    sync: syncVpnUser,
  },
  billing: {
    mySummary: myBillingSummary,
    adminSummary: adminBillingSummary,
    list: listOutstandingBilling,
    claimPaid: claimBillingPaid,
    settle: settleBillingEvent,
    unsettle: unsettleBillingEvent,
  },
  audit: {
    list: listAuditLogs,
  },
  tools: {
    updateContact: updateUserContact,
    bulkLabel,
    bulkRenew,
    exportUsers,
    exportBilling,
    importUsers,
    setResellerLimits,
    suspendReseller: suspendResellerAccount,
    resumeReseller: resumeResellerAccount,
    announcement: getAnnouncement,
    announcementAdmin: getAnnouncementAdmin,
    setAnnouncement,
  },
  notifications: {
    status: telegramStatus,
    startLink: startTelegramLink,
    unlink: unlinkMyTelegram,
    sendTest: sendTestMessage,
    adminConfig: getTelegramAdmin,
    saveConfig: saveTelegramAdmin,
    registerWebhook: registerTelegramWebhook,
    stats: outboxStats,
    linkedAccounts: telegramLinkedAccounts,
    adminUnlink: adminUnlinkTelegram,
  },
  public: { view: publicView, requestRenewal: publicRequestRenewal },
  customers: {
    createLink: createCustomerLink,
    revokeLink: revokeCustomerLink,
    renewals: listRenewalRequests,
    approveRenewal: approveRenewalRequest,
    rejectRenewal: rejectRenewalRequest,
    branding: getBranding,
    setBranding,
  },
  wallet: {
    mine: myWallet,
    forReseller: resellerWallet,
    adjust: adjustWallet,
    setBalance,
    setCreditLimit,
  },
}

export default router
