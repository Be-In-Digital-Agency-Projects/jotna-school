/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as ResendOTPPasswordReset from "../ResendOTPPasswordReset.js";
import type * as access from "../access.js";
import type * as accessRules from "../accessRules.js";
import type * as aiGateway_budget from "../aiGateway/budget.js";
import type * as aiGateway_db from "../aiGateway/db.js";
import type * as aiGateway_factCheck from "../aiGateway/factCheck.js";
import type * as aiGateway_index from "../aiGateway/index.js";
import type * as aiGateway_quota from "../aiGateway/quota.js";
import type * as aiGateway_registry from "../aiGateway/registry.js";
import type * as aiGateway_spendShards from "../aiGateway/spendShards.js";
import type * as attempts from "../attempts.js";
import type * as attemptsExplain from "../attemptsExplain.js";
import type * as attemptsVerify from "../attemptsVerify.js";
import type * as auth from "../auth.js";
import type * as badges from "../badges.js";
import type * as billing from "../billing.js";
import type * as billingBictorys from "../billingBictorys.js";
import type * as billingPaydunya from "../billingPaydunya.js";
import type * as billingRules from "../billingRules.js";
import type * as crons from "../crons.js";
import type * as curriculum from "../curriculum.js";
import type * as exercises from "../exercises.js";
import type * as explainMistake from "../explainMistake.js";
import type * as http from "../http.js";
import type * as importCodes from "../importCodes.js";
import type * as linkRequests from "../linkRequests.js";
import type * as linkRequestsEmail from "../linkRequestsEmail.js";
import type * as linkRules from "../linkRules.js";
import type * as migrations from "../migrations.js";
import type * as palierAttempts from "../palierAttempts.js";
import type * as paliers_index from "../paliers/index.js";
import type * as paliers_prompts from "../paliers/prompts.js";
import type * as paliers_scoring from "../paliers/scoring.js";
import type * as parentLink from "../parentLink.js";
import type * as pdfUploads from "../pdfUploads.js";
import type * as pdfUploadsExtract from "../pdfUploadsExtract.js";
import type * as pricing from "../pricing.js";
import type * as profileRules from "../profileRules.js";
import type * as profiles from "../profiles.js";
import type * as progress from "../progress.js";
import type * as regenNotificationEmail from "../regenNotificationEmail.js";
import type * as reports from "../reports.js";
import type * as reportsEmail from "../reportsEmail.js";
import type * as resetContent from "../resetContent.js";
import type * as resetDeployment from "../resetDeployment.js";
import type * as roleRules from "../roleRules.js";
import type * as schools from "../schools.js";
import type * as secureRandom from "../secureRandom.js";
import type * as settings_index from "../settings/index.js";
import type * as streak from "../streak.js";
import type * as studentCredentials from "../studentCredentials.js";
import type * as studentImport from "../studentImport.js";
import type * as studentImportRun from "../studentImportRun.js";
import type * as students from "../students.js";
import type * as subjects from "../subjects.js";
import type * as subscriptionRules from "../subscriptionRules.js";
import type * as testSeeds from "../testSeeds.js";
import type * as topics from "../topics.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  ResendOTPPasswordReset: typeof ResendOTPPasswordReset;
  access: typeof access;
  accessRules: typeof accessRules;
  "aiGateway/budget": typeof aiGateway_budget;
  "aiGateway/db": typeof aiGateway_db;
  "aiGateway/factCheck": typeof aiGateway_factCheck;
  "aiGateway/index": typeof aiGateway_index;
  "aiGateway/quota": typeof aiGateway_quota;
  "aiGateway/registry": typeof aiGateway_registry;
  "aiGateway/spendShards": typeof aiGateway_spendShards;
  attempts: typeof attempts;
  attemptsExplain: typeof attemptsExplain;
  attemptsVerify: typeof attemptsVerify;
  auth: typeof auth;
  badges: typeof badges;
  billing: typeof billing;
  billingBictorys: typeof billingBictorys;
  billingPaydunya: typeof billingPaydunya;
  billingRules: typeof billingRules;
  crons: typeof crons;
  curriculum: typeof curriculum;
  exercises: typeof exercises;
  explainMistake: typeof explainMistake;
  http: typeof http;
  importCodes: typeof importCodes;
  linkRequests: typeof linkRequests;
  linkRequestsEmail: typeof linkRequestsEmail;
  linkRules: typeof linkRules;
  migrations: typeof migrations;
  palierAttempts: typeof palierAttempts;
  "paliers/index": typeof paliers_index;
  "paliers/prompts": typeof paliers_prompts;
  "paliers/scoring": typeof paliers_scoring;
  parentLink: typeof parentLink;
  pdfUploads: typeof pdfUploads;
  pdfUploadsExtract: typeof pdfUploadsExtract;
  pricing: typeof pricing;
  profileRules: typeof profileRules;
  profiles: typeof profiles;
  progress: typeof progress;
  regenNotificationEmail: typeof regenNotificationEmail;
  reports: typeof reports;
  reportsEmail: typeof reportsEmail;
  resetContent: typeof resetContent;
  resetDeployment: typeof resetDeployment;
  roleRules: typeof roleRules;
  schools: typeof schools;
  secureRandom: typeof secureRandom;
  "settings/index": typeof settings_index;
  streak: typeof streak;
  studentCredentials: typeof studentCredentials;
  studentImport: typeof studentImport;
  studentImportRun: typeof studentImportRun;
  students: typeof students;
  subjects: typeof subjects;
  subscriptionRules: typeof subscriptionRules;
  testSeeds: typeof testSeeds;
  topics: typeof topics;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
