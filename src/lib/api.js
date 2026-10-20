/**
 * The app's data API. Uses Supabase normally, or the in-browser demo backend
 * when VITE_DEMO_MODE=true (see demoApi.js and docs/SETUP.md).
 */
import * as real from './supabaseApi'
import * as demo from './demoApi'
import { supabase } from './supabase'

export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true'

const impl = DEMO_MODE ? demo : real

/** The auth client: supabase.auth, or the demo stand-in with the same methods. */
export const authClient = DEMO_MODE ? demo.auth : supabase.auth

export const { PAGE_SIZE, sanitizeSearch, addDays, zonedDayStart } = real
export const { DEMO_ACCOUNTS, DEMO_PASSWORD, resetDemo } = demo

export const getSettings = (...a) => impl.getSettings(...a)
export const getMealPeriods = (...a) => impl.getMealPeriods(...a)
export const getSchoolToday = (...a) => impl.getSchoolToday(...a)
export const getFeedingPlans = (...a) => impl.getFeedingPlans(...a)
export const setFeedingPlan = (...a) => impl.setFeedingPlan(...a)
export const feedingPlanSummary = (...a) => impl.feedingPlanSummary(...a)
export const countStudentsByPlan = (...a) => impl.countStudentsByPlan(...a)
export const checkIn = (...a) => impl.checkIn(...a)
export const searchStudents = (...a) => impl.searchStudents(...a)
export const listRecords = (...a) => impl.listRecords(...a)
export const countRecordsByPeriod = (...a) => impl.countRecordsByPeriod(...a)
export const fetchAllRecords = (...a) => impl.fetchAllRecords(...a)
export const studentMealCounts = (...a) => impl.studentMealCounts(...a)
export const correctRecord = (...a) => impl.correctRecord(...a)
export const addRecord = (...a) => impl.addRecord(...a)
export const listStudents = (...a) => impl.listStudents(...a)
export const saveStudent = (...a) => impl.saveStudent(...a)
export const importStudents = (...a) => impl.importStudents(...a)
export const getOwnProfile = (...a) => impl.getOwnProfile(...a)
export const listStaff = (...a) => impl.listStaff(...a)
export const updateStaff = (...a) => impl.updateStaff(...a)
export const listAudit = (...a) => impl.listAudit(...a)
