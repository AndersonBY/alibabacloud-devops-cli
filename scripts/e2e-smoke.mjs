#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const cliPath = path.join(projectRoot, "dist", "index.js");
const tmpRoot = path.join(projectRoot, ".tmp", "e2e");
const runStartedAt = new Date();
const runId = String(runStartedAt.getTime());
const structuredStepReport = [];

const env = { ...process.env };
loadDotEnv(path.resolve(projectRoot, ".env"), env);
loadDotEnv(path.resolve(projectRoot, "..", ".env"), env);

const token = env.YUNXIAO_ACCESS_TOKEN || env.CODEUP_TOKEN;
if (!token) {
  fail("Missing token. Set YUNXIAO_ACCESS_TOKEN or CODEUP_TOKEN in environment/.env.");
}
env.YUNXIAO_ACCESS_TOKEN = token;

const report = [];
const warnings = [];

let repositoryId;
let organizationId = env.YX_E2E_ORG_ID;
let localId;
let issueId;
let issueCommentId;
let issueDeleteFormatId;
let issueDeleteOutId;
let projectId;
let projectCreatedBySmoke = false;
let projectNameCreatedBySmoke;
let baseBranch = "main";
let orgSecretName;
let repoSecretName;
let pipelineSecretName;
let pipelineScopeId;
let createdLabelName;
let featureHeadSha;
let webhookId;
let createdReleaseTag;
let currentUserId;
let status = "PASS";
let errorMessage;
let configSnapshot;

try {
  configSnapshot = backupUserConfig();
  ensureDir(tmpRoot);
  if (!fs.existsSync(cliPath)) {
    fail("Missing dist/index.js. Run `npm run build` first.");
  }
  note("build", "skip (dist exists)");

  if (!organizationId) {
    const orgs = runJson(["org", "list", "--json"], { step: "org.list" });
    if (!Array.isArray(orgs) || orgs.length === 0) {
      fail("No organizations available for this token.");
    }
    organizationId = readFirstString(orgs[0], ["id"]);
  }

  if (!organizationId) {
    fail("Unable to resolve organization ID.");
  }
  note("org", organizationId);

  const currentUser = runJson(["org", "current", "--json"], { step: "org.current" });
  currentUserId = readFirstString(currentUser, ["id"]);
  if (!currentUserId) {
    fail("org current returned no user id");
  }
  note("user", currentUserId);

  const authStatus = runJson(["auth", "status", "--json"], { step: "auth.status.json" });
  if (typeof authStatus !== "object" || authStatus === null || typeof authStatus.hasToken !== "boolean") {
    fail("auth status --json verification failed: invalid response shape");
  }

  const configPath = runJson(["config", "path", "--json"], { step: "config.path.json" });
  if (typeof configPath !== "object" || configPath === null || typeof configPath.path !== "string") {
    fail("config path --json verification failed: invalid response shape");
  }

  const configDefaults = runJson(["config", "get", "defaults", "--json"], { step: "config.get.defaults.json" });
  if (typeof configDefaults !== "object" || configDefaults === null) {
    fail("config get defaults --json verification failed: invalid response shape");
  }

  const completionBash = runJson(["completion", "bash", "--json"], { step: "completion.bash.json" });
  if (
    typeof completionBash !== "object" ||
    completionBash === null ||
    completionBash.shell !== "bash" ||
    typeof completionBash.script !== "string" ||
    completionBash.script.length === 0
  ) {
    fail("completion bash --json verification failed: invalid response shape");
  }

  const aliasName = `e2e-alias-${Date.now()}`;
  const aliasSet = runJson(["alias", "set", aliasName, "repo", "list", "--json"], { step: "alias.set.json" });
  if (!isRecord(aliasSet) || aliasSet.name !== aliasName) {
    fail("alias set --json verification failed: invalid response shape");
  }
  const aliasList = runJson(["alias", "list", "--json"], { step: "alias.list.json" });
  if (!Array.isArray(aliasList) || !aliasList.some((item) => isRecord(item) && item.name === aliasName)) {
    fail("alias list --json verification failed: alias not found");
  }
  const aliasDelete = runJson(["alias", "delete", aliasName, "--json"], { step: "alias.delete.json" });
  if (!isRecord(aliasDelete) || aliasDelete.removed !== true || aliasDelete.name !== aliasName) {
    fail("alias delete --json verification failed: invalid response shape");
  }

  const repoName = `yx-e2e-${Date.now()}`;
  const createdRepo = runJson(
    [
      "repo",
      "create",
      repoName,
      "--org",
      organizationId,
      "--private",
      "--add-readme",
      "--description",
      "yx e2e smoke repo",
      "--json",
    ],
    { step: "repo.create" }
  );
  repositoryId = readFirstString(createdRepo, ["id", "repositoryId", "result.id", "create.id"]);
  if (!repositoryId) {
    fail("repo create returned no repository id");
  }
  note("repo.create", repositoryId);

  const orgUseProjectId = `yx-e2e-project-${Date.now()}`;
  const orgUseResult = runJson(["org", "use", organizationId, "--project", orgUseProjectId, "--json"], {
    step: "org.use.json",
  });
  if (
    !isRecord(orgUseResult) ||
    orgUseResult.updated !== true ||
    !isRecord(orgUseResult.defaults) ||
    orgUseResult.defaults.organizationId !== organizationId
  ) {
    fail("org use --json verification failed: invalid response shape");
  }
  const orgUseFormatJson = runJson(["org", "use", organizationId, "--project", orgUseProjectId, "--format", "json"], {
    step: "org.use.format.json",
  });
  if (
    !isRecord(orgUseFormatJson) ||
    orgUseFormatJson.updated !== true ||
    !isRecord(orgUseFormatJson.defaults) ||
    orgUseFormatJson.defaults.organizationId !== organizationId
  ) {
    fail("org use --format json verification failed: invalid response shape");
  }
  const orgUseFormatTsvOutput = runChecked(
    ["node", cliPath, "org", "use", organizationId, "--project", orgUseProjectId, "--format", "tsv"],
    {
      cwd: projectRoot,
      env,
      step: "org.use.format.tsv",
    }
  ).stdout.trim();
  if (!orgUseFormatTsvOutput.includes("key\tvalue")) {
    fail("org use --format tsv verification failed: missing tsv header");
  }
  const orgUseOutPath = path.join(tmpRoot, `org-use-${runId}.tsv`);
  runChecked(
    [
      "node",
      cliPath,
      "org",
      "use",
      organizationId,
      "--project",
      orgUseProjectId,
      "--format",
      "tsv",
      "--out",
      orgUseOutPath,
    ],
    {
      cwd: projectRoot,
      env,
      step: "org.use.out.tsv",
    }
  );
  if (!fs.existsSync(orgUseOutPath)) {
    fail("org use --out verification failed: output file not found");
  }
  const orgUseOutText = fs.readFileSync(orgUseOutPath, "utf-8");
  if (!orgUseOutText.includes("key\tvalue")) {
    fail("org use --out verification failed: missing tsv header");
  }
  runExpectedFailure(
    ["node", cliPath, "org", "use", organizationId, "--project", orgUseProjectId, "--format", "bad"],
    {
      cwd: projectRoot,
      env,
      step: "org.use.format.invalid",
      contains: "Invalid --format value",
    }
  );
  runExpectedFailure(
    [
      "node",
      cliPath,
      "org",
      "use",
      organizationId,
      "--project",
      orgUseProjectId,
      "--format",
      "table",
      "--out",
      path.join(tmpRoot, `org-use-invalid-out-${runId}.txt`),
    ],
    {
      cwd: projectRoot,
      env,
      step: "org.use.out.table.invalid",
      contains: "--out` requires --format tsv/json",
    }
  );

  const orgReadSoftFrom = structuredStepReport.length;
  try {
    const orgCurrentFormatJson = runJson(["org", "current", "--format", "json"], {
      step: "org.read.current.format.json",
    });
    if (!isRecord(orgCurrentFormatJson) || !readFirstString(orgCurrentFormatJson, ["id"])) {
      fail("org current --format json verification failed: invalid response shape");
    }
    const orgCurrentFormatTsvOutput = runChecked(["node", cliPath, "org", "current", "--format", "tsv"], {
      cwd: projectRoot,
      env,
      step: "org.read.current.format.tsv",
    }).stdout.trim();
    if (!orgCurrentFormatTsvOutput.includes("key\tvalue")) {
      fail("org current --format tsv verification failed: missing tsv header");
    }
    const orgCurrentOutPath = path.join(tmpRoot, `org-current-${runId}.tsv`);
    runChecked(["node", cliPath, "org", "current", "--format", "tsv", "--out", orgCurrentOutPath], {
      cwd: projectRoot,
      env,
      step: "org.read.current.out.tsv",
    });
    if (!fs.existsSync(orgCurrentOutPath)) {
      fail("org current --out verification failed: output file not found");
    }
    if (!fs.readFileSync(orgCurrentOutPath, "utf-8").includes("key\tvalue")) {
      fail("org current --out verification failed: missing tsv header");
    }
    runExpectedFailure(["node", cliPath, "org", "current", "--format", "bad"], {
      cwd: projectRoot,
      env,
      step: "org.read.current.format.invalid",
      contains: "Invalid --format value",
    });
    runExpectedFailure(
      [
        "node",
        cliPath,
        "org",
        "current",
        "--format",
        "table",
        "--out",
        path.join(tmpRoot, `org-current-invalid-out-${runId}.txt`),
      ],
      {
        cwd: projectRoot,
        env,
        step: "org.read.current.out.table.invalid",
        contains: "--out` requires --format tsv/json",
      }
    );

    const orgListFormatJson = runJson(["org", "list", "--format", "json"], {
      step: "org.read.list.format.json",
    });
    if (!Array.isArray(orgListFormatJson)) {
      fail("org list --format json verification failed: invalid response shape");
    }
    const orgListFormatTsvOutput = runChecked(["node", cliPath, "org", "list", "--format", "tsv"], {
      cwd: projectRoot,
      env,
      step: "org.read.list.format.tsv",
    }).stdout.trim();
    if (!orgListFormatTsvOutput) {
      fail("org list --format tsv verification failed: empty output");
    }
    const orgListOutPath = path.join(tmpRoot, `org-list-${runId}.tsv`);
    runChecked(["node", cliPath, "org", "list", "--format", "tsv", "--out", orgListOutPath], {
      cwd: projectRoot,
      env,
      step: "org.read.list.out.tsv",
    });
    if (!fs.existsSync(orgListOutPath)) {
      fail("org list --out verification failed: output file not found");
    }
    if (!fs.readFileSync(orgListOutPath, "utf-8").trim()) {
      fail("org list --out verification failed: empty file");
    }
    runExpectedFailure(["node", cliPath, "org", "list", "--format", "bad"], {
      cwd: projectRoot,
      env,
      step: "org.read.list.format.invalid",
      contains: "Invalid --format value",
    });
    runExpectedFailure(
      [
        "node",
        cliPath,
        "org",
        "list",
        "--format",
        "table",
        "--out",
        path.join(tmpRoot, `org-list-invalid-out-${runId}.txt`),
      ],
      {
        cwd: projectRoot,
        env,
        step: "org.read.list.out.table.invalid",
        contains: "--out` requires --format tsv/json",
      }
    );

    const orgMembersFormatJson = runJson(
      ["org", "members", "--org", organizationId, "--per-page", "20", "--format", "json"],
      { step: "org.read.members.format.json" }
    );
    if (!Array.isArray(orgMembersFormatJson) && !isRecord(orgMembersFormatJson)) {
      fail("org members --format json verification failed: invalid response shape");
    }
    const orgMembersFormatTsvOutput = runChecked(
      ["node", cliPath, "org", "members", "--org", organizationId, "--per-page", "20", "--format", "tsv"],
      {
        cwd: projectRoot,
        env,
        step: "org.read.members.format.tsv",
      }
    ).stdout.trim();
    if (!orgMembersFormatTsvOutput) {
      fail("org members --format tsv verification failed: empty output");
    }
    const orgMembersOutPath = path.join(tmpRoot, `org-members-${runId}.tsv`);
    runChecked(
      ["node", cliPath, "org", "members", "--org", organizationId, "--per-page", "20", "--format", "tsv", "--out", orgMembersOutPath],
      {
        cwd: projectRoot,
        env,
        step: "org.read.members.out.tsv",
      }
    );
    if (!fs.existsSync(orgMembersOutPath)) {
      fail("org members --out verification failed: output file not found");
    }
    runExpectedFailure(
      ["node", cliPath, "org", "members", "--org", organizationId, "--per-page", "20", "--format", "bad"],
      {
        cwd: projectRoot,
        env,
        step: "org.read.members.format.invalid",
        contains: "Invalid --format value",
      }
    );
    runExpectedFailure(
      [
        "node",
        cliPath,
        "org",
        "members",
        "--org",
        organizationId,
        "--per-page",
        "20",
        "--format",
        "table",
        "--out",
        path.join(tmpRoot, `org-members-invalid-out-${runId}.txt`),
      ],
      {
        cwd: projectRoot,
        env,
        step: "org.read.members.out.table.invalid",
        contains: "--out` requires --format tsv/json",
      }
    );

    const orgProjectsFormatJson = runJson(
      ["org", "projects", "--org", organizationId, "--per-page", "20", "--format", "json"],
      { step: "org.read.projects.format.json" }
    );
    if (!Array.isArray(orgProjectsFormatJson) && !isRecord(orgProjectsFormatJson)) {
      fail("org projects --format json verification failed: invalid response shape");
    }
    const orgProjectsFormatTsvOutput = runChecked(
      ["node", cliPath, "org", "projects", "--org", organizationId, "--per-page", "20", "--format", "tsv"],
      {
        cwd: projectRoot,
        env,
        step: "org.read.projects.format.tsv",
      }
    ).stdout.trim();
    if (!orgProjectsFormatTsvOutput) {
      fail("org projects --format tsv verification failed: empty output");
    }
    const orgProjectsOutPath = path.join(tmpRoot, `org-projects-${runId}.tsv`);
    runChecked(
      ["node", cliPath, "org", "projects", "--org", organizationId, "--per-page", "20", "--format", "tsv", "--out", orgProjectsOutPath],
      {
        cwd: projectRoot,
        env,
        step: "org.read.projects.out.tsv",
      }
    );
    if (!fs.existsSync(orgProjectsOutPath)) {
      fail("org projects --out verification failed: output file not found");
    }
    runExpectedFailure(
      ["node", cliPath, "org", "projects", "--org", organizationId, "--per-page", "20", "--format", "bad"],
      {
        cwd: projectRoot,
        env,
        step: "org.read.projects.format.invalid",
        contains: "Invalid --format value",
      }
    );
    runExpectedFailure(
      [
        "node",
        cliPath,
        "org",
        "projects",
        "--org",
        organizationId,
        "--per-page",
        "20",
        "--format",
        "table",
        "--out",
        path.join(tmpRoot, `org-projects-invalid-out-${runId}.txt`),
      ],
      {
        cwd: projectRoot,
        env,
        step: "org.read.projects.out.table.invalid",
        contains: "--out` requires --format tsv/json",
      }
    );

    const orgTemplatesFormatJson = runJson(["org", "project-templates", "--org", organizationId, "--format", "json"], {
      step: "org.read.project-templates.format.json",
    });
    if (!Array.isArray(orgTemplatesFormatJson) && !isRecord(orgTemplatesFormatJson)) {
      fail("org project-templates --format json verification failed: invalid response shape");
    }
    const orgTemplatesFormatTsvOutput = runChecked(
      ["node", cliPath, "org", "project-templates", "--org", organizationId, "--format", "tsv"],
      {
        cwd: projectRoot,
        env,
        step: "org.read.project-templates.format.tsv",
      }
    ).stdout.trim();
    if (!orgTemplatesFormatTsvOutput) {
      fail("org project-templates --format tsv verification failed: empty output");
    }
    const orgTemplatesOutPath = path.join(tmpRoot, `org-project-templates-${runId}.tsv`);
    runChecked(
      ["node", cliPath, "org", "project-templates", "--org", organizationId, "--format", "tsv", "--out", orgTemplatesOutPath],
      {
        cwd: projectRoot,
        env,
        step: "org.read.project-templates.out.tsv",
      }
    );
    if (!fs.existsSync(orgTemplatesOutPath)) {
      fail("org project-templates --out verification failed: output file not found");
    }
    runExpectedFailure(
      ["node", cliPath, "org", "project-templates", "--org", organizationId, "--format", "bad"],
      {
        cwd: projectRoot,
        env,
        step: "org.read.project-templates.format.invalid",
        contains: "Invalid --format value",
      }
    );
    runExpectedFailure(
      [
        "node",
        cliPath,
        "org",
        "project-templates",
        "--org",
        organizationId,
        "--format",
        "table",
        "--out",
        path.join(tmpRoot, `org-project-templates-invalid-out-${runId}.txt`),
      ],
      {
        cwd: projectRoot,
        env,
        step: "org.read.project-templates.out.table.invalid",
        contains: "--out` requires --format tsv/json",
      }
    );

    const orgRolesFormatJson = runJson(["org", "roles", "--org", organizationId, "--format", "json"], {
      step: "org.read.roles.format.json",
    });
    if (!Array.isArray(orgRolesFormatJson) && !isRecord(orgRolesFormatJson)) {
      fail("org roles --format json verification failed: invalid response shape");
    }
    const orgRolesFormatTsvOutput = runChecked(
      ["node", cliPath, "org", "roles", "--org", organizationId, "--format", "tsv"],
      {
        cwd: projectRoot,
        env,
        step: "org.read.roles.format.tsv",
      }
    ).stdout.trim();
    if (!orgRolesFormatTsvOutput) {
      fail("org roles --format tsv verification failed: empty output");
    }
    const orgRolesOutPath = path.join(tmpRoot, `org-roles-${runId}.tsv`);
    runChecked(["node", cliPath, "org", "roles", "--org", organizationId, "--format", "tsv", "--out", orgRolesOutPath], {
      cwd: projectRoot,
      env,
      step: "org.read.roles.out.tsv",
    });
    if (!fs.existsSync(orgRolesOutPath)) {
      fail("org roles --out verification failed: output file not found");
    }
    runExpectedFailure(["node", cliPath, "org", "roles", "--org", organizationId, "--format", "bad"], {
      cwd: projectRoot,
      env,
      step: "org.read.roles.format.invalid",
      contains: "Invalid --format value",
    });
    runExpectedFailure(
      [
        "node",
        cliPath,
        "org",
        "roles",
        "--org",
        organizationId,
        "--format",
        "table",
        "--out",
        path.join(tmpRoot, `org-roles-invalid-out-${runId}.txt`),
      ],
      {
        cwd: projectRoot,
        env,
        step: "org.read.roles.out.table.invalid",
        contains: "--out` requires --format tsv/json",
      }
    );

    note("org.read", "current/list/members/projects/project-templates/roles format/out");
  } catch (error) {
    for (let i = orgReadSoftFrom; i < structuredStepReport.length; i += 1) {
      const item = structuredStepReport[i];
      if (item && item.step && String(item.step).startsWith("org.read.") && item.status === "FAIL") {
        item.status = "SOFT_FAIL";
      }
    }
    warnings.push(`org read format/out tests skipped: ${sanitizeText(error instanceof Error ? error.message : String(error))}`);
  }

  const repoSetDefaultResult = runJson(["repo", "set-default", repositoryId, "--no-verify", "--json"], {
    step: "repo.set-default.json",
  });
  if (
    !isRecord(repoSetDefaultResult) ||
    repoSetDefaultResult.updated !== true ||
    !isRecord(repoSetDefaultResult.defaults) ||
    repoSetDefaultResult.defaults.repositoryId !== repositoryId
  ) {
    fail("repo set-default --json verification failed: invalid response shape");
  }

  const tempDefaultProjectId = `yx-e2e-project-config-${Date.now()}`;
  const configSetResult = runJson(["config", "set", "defaults.projectId", tempDefaultProjectId, "--json"], {
    step: "config.set.defaults.projectId.json",
  });
  if (!isRecord(configSetResult) || configSetResult.updated !== true || configSetResult.key !== "defaults.projectId") {
    fail("config set --json verification failed: invalid response shape");
  }

  const configUnsetResult = runJson(["config", "unset", "defaults.projectId", "--json"], {
    step: "config.unset.defaults.projectId.json",
  });
  if (!isRecord(configUnsetResult) || configUnsetResult.removed !== true || configUnsetResult.key !== "defaults.projectId") {
    fail("config unset --json verification failed: invalid response shape");
  }

  const repoDetail = runJson(["repo", "view", repositoryId, "--org", organizationId, "--json"], {
    step: "repo.view",
  });
  baseBranch = readFirstString(repoDetail, ["defaultBranch"]) || "main";
  note("repo.view", "ok");

  const browseUrl = runChecked(["node", cliPath, "browse", "repo", repositoryId, "--org", organizationId, "--print"], {
    cwd: projectRoot,
    env,
    step: "browse.repo",
  }).stdout.trim();
  if (!browseUrl.startsWith("http")) {
    fail("browse repo did not return URL");
  }
  note("browse.repo", browseUrl);

  ensureDir(tmpRoot);
  const clonePath = path.join(tmpRoot, repoName);
  cleanPath(clonePath);
  runJson(["repo", "clone", repositoryId, clonePath, "--org", organizationId, "--json"], {
    step: "repo.clone",
  });
  note("repo.clone", clonePath);

  const currentBranch = runChecked(["git", "-C", clonePath, "branch", "--show-current"], {
    step: "git.current-branch",
  }).stdout.trim();
  if (!currentBranch) {
    runChecked(["git", "-C", clonePath, "checkout", "-b", baseBranch], {
      step: "git.checkout-base",
    });
  } else {
    baseBranch = currentBranch;
  }

  writeText(path.join(clonePath, ".e2e-base.txt"), `base at ${new Date().toISOString()}${os.EOL}`);
  runChecked(["git", "-C", clonePath, "add", ".e2e-base.txt"], { step: "git.base.add" });
  runChecked(["git", "-C", clonePath, "commit", "-m", "test: seed base branch"], {
    step: "git.base.commit",
  });
  runChecked(
    [
      "git",
      "-C",
      clonePath,
      "-c",
      `http.extraHeader=x-yunxiao-token: ${token}`,
      "push",
      "-u",
      "origin",
      baseBranch,
    ],
    { step: "git.base.push" }
  );

  runJson(["repo", "branch", "list", repositoryId, "--org", organizationId, "--json"], {
    step: "repo.branch.list",
  });
  const tempBranch = `tmp/e2e-${Date.now()}`;
  runJson(
    ["repo", "branch", "create", repositoryId, tempBranch, "--org", organizationId, "--ref", baseBranch, "--json"],
    {
      step: "repo.branch.create",
    }
  );
  runJson(["repo", "branch", "delete", repositoryId, tempBranch, "--org", organizationId, "--yes", "--json"], {
    step: "repo.branch.delete",
  });
  note("repo.branch", "list/create/delete");

  runJson(["repo", "tag", "list", repositoryId, "--org", organizationId, "--json"], {
    step: "repo.tag.list",
  });
  const tempTag = `v0.0.0-e2e-${Date.now()}`;
  runJson(
    [
      "repo",
      "tag",
      "create",
      repositoryId,
      tempTag,
      "--org",
      organizationId,
      "--ref",
      baseBranch,
      "--message",
      "created by e2e smoke",
      "--json",
    ],
    {
      step: "repo.tag.create",
    }
  );
  runJson(["repo", "tag", "delete", repositoryId, tempTag, "--org", organizationId, "--yes", "--json"], {
    step: "repo.tag.delete",
  });
  note("repo.tag", "list/create/delete");

  const releaseTag = `v0.0.0-release-e2e-${Date.now()}`;
  const releaseCreate = runJson(
    [
      "release",
      "create",
      "--repo",
      repositoryId,
      "--org",
      organizationId,
      "--tag",
      releaseTag,
      "--ref",
      baseBranch,
      "--title",
      "e2e release title",
      "--notes",
      "e2e release notes",
      "--json",
    ],
    {
      step: "release.create",
    }
  );
  if (!isRecord(releaseCreate) || releaseCreate.tagName !== releaseTag) {
    fail("release create verification failed: invalid response shape");
  }
  createdReleaseTag = releaseTag;
  const releaseCreateFormatTsvTag = `v0.0.0-release-e2e-create-tsv-${Date.now()}`;
  const releaseCreateFormatTsvOutput = runChecked(
    [
      "node",
      cliPath,
      "release",
      "create",
      "--repo",
      repositoryId,
      "--org",
      organizationId,
      "--tag",
      releaseCreateFormatTsvTag,
      "--ref",
      baseBranch,
      "--title",
      "e2e release title tsv",
      "--notes",
      "e2e release notes tsv",
      "--format",
      "tsv",
    ],
    {
      cwd: projectRoot,
      env,
      step: "release.create.format.tsv",
    }
  ).stdout.trim();
  if (!releaseCreateFormatTsvOutput.includes("key\tvalue")) {
    fail("release create --format tsv verification failed: missing tsv header");
  }
  runJson(["release", "delete", releaseCreateFormatTsvTag, "--repo", repositoryId, "--org", organizationId, "--yes", "--json"], {
    step: "release.create.format.tsv.cleanup",
  });
  const releaseCreateOutTag = `v0.0.0-release-e2e-create-out-${Date.now()}`;
  const releaseCreateOutPath = path.join(tmpRoot, `release-create-${runId}.tsv`);
  runChecked(
    [
      "node",
      cliPath,
      "release",
      "create",
      "--repo",
      repositoryId,
      "--org",
      organizationId,
      "--tag",
      releaseCreateOutTag,
      "--ref",
      baseBranch,
      "--title",
      "e2e release title out",
      "--notes",
      "e2e release notes out",
      "--format",
      "tsv",
      "--out",
      releaseCreateOutPath,
    ],
    {
      cwd: projectRoot,
      env,
      step: "release.create.out.tsv",
    }
  );
  if (!fs.existsSync(releaseCreateOutPath)) {
    fail("release create --out verification failed: output file not found");
  }
  const releaseCreateOutText = fs.readFileSync(releaseCreateOutPath, "utf-8");
  if (!releaseCreateOutText.includes("key\tvalue")) {
    fail("release create --out verification failed: missing tsv header");
  }
  runJson(["release", "delete", releaseCreateOutTag, "--repo", repositoryId, "--org", organizationId, "--yes", "--json"], {
    step: "release.create.out.cleanup",
  });
  runExpectedFailure(
    [
      "node",
      cliPath,
      "release",
      "create",
      "--repo",
      repositoryId,
      "--org",
      organizationId,
      "--tag",
      `v0.0.0-release-e2e-create-invalid-${Date.now()}`,
      "--ref",
      baseBranch,
      "--format",
      "bad",
    ],
    {
      cwd: projectRoot,
      env,
      step: "release.create.format.invalid",
      contains: "Invalid --format value",
    }
  );
  runExpectedFailure(
    [
      "node",
      cliPath,
      "release",
      "create",
      "--repo",
      repositoryId,
      "--org",
      organizationId,
      "--tag",
      `v0.0.0-release-e2e-create-invalid-out-${Date.now()}`,
      "--ref",
      baseBranch,
      "--format",
      "table",
      "--out",
      path.join(tmpRoot, `release-create-invalid-out-${runId}.txt`),
    ],
    {
      cwd: projectRoot,
      env,
      step: "release.create.out.table.invalid",
      contains: "--out` requires --format tsv/json",
    }
  );

  const releaseView = runJson(["release", "view", releaseTag, "--repo", repositoryId, "--org", organizationId, "--json"], {
    step: "release.view",
  });
  if (!isRecord(releaseView) || releaseView.tagName !== releaseTag) {
    fail("release view verification failed: invalid response shape");
  }
  const releaseViewFormatJson = runJson(
    ["release", "view", releaseTag, "--repo", repositoryId, "--org", organizationId, "--format", "json"],
    {
      step: "release.view.format.json",
    }
  );
  if (!isRecord(releaseViewFormatJson) || releaseViewFormatJson.tagName !== releaseTag) {
    fail("release view --format json verification failed: invalid response shape");
  }
  const releaseViewFormatTsvOutput = runChecked(
    ["node", cliPath, "release", "view", releaseTag, "--repo", repositoryId, "--org", organizationId, "--format", "tsv"],
    {
      cwd: projectRoot,
      env,
      step: "release.view.format.tsv",
    }
  ).stdout.trim();
  if (!releaseViewFormatTsvOutput.includes("key\tvalue")) {
    fail("release view --format tsv verification failed: missing tsv header");
  }
  const releaseViewOutPath = path.join(tmpRoot, `release-view-${runId}.tsv`);
  runChecked(
    [
      "node",
      cliPath,
      "release",
      "view",
      releaseTag,
      "--repo",
      repositoryId,
      "--org",
      organizationId,
      "--format",
      "tsv",
      "--out",
      releaseViewOutPath,
    ],
    {
      cwd: projectRoot,
      env,
      step: "release.view.out.tsv",
    }
  );
  if (!fs.existsSync(releaseViewOutPath)) {
    fail("release view --out verification failed: output file not found");
  }
  const releaseViewOutText = fs.readFileSync(releaseViewOutPath, "utf-8");
  if (!releaseViewOutText.includes("key\tvalue")) {
    fail("release view --out verification failed: missing tsv header");
  }
  runExpectedFailure(
    ["node", cliPath, "release", "view", releaseTag, "--repo", repositoryId, "--org", organizationId, "--format", "bad"],
    {
      cwd: projectRoot,
      env,
      step: "release.view.format.invalid",
      contains: "Invalid --format value",
    }
  );
  runExpectedFailure(
    [
      "node",
      cliPath,
      "release",
      "view",
      releaseTag,
      "--repo",
      repositoryId,
      "--org",
      organizationId,
      "--format",
      "table",
      "--out",
      path.join(tmpRoot, `release-view-invalid-out-${runId}.txt`),
    ],
    {
      cwd: projectRoot,
      env,
      step: "release.view.out.table.invalid",
      contains: "--out` requires --format tsv/json",
    }
  );
  const releaseList = runJson(["release", "list", "--repo", repositoryId, "--org", organizationId, "--search", releaseTag, "--json"], {
    step: "release.list",
  });
  if (!hasRelease(releaseList, releaseTag)) {
    fail("release list verification failed: created release not found");
  }
  const releaseListFormatJson = runJson(
    ["release", "list", "--repo", repositoryId, "--org", organizationId, "--search", releaseTag, "--format", "json"],
    {
      step: "release.list.format.json",
    }
  );
  if (!hasRelease(releaseListFormatJson, releaseTag)) {
    fail("release list --format json verification failed: created release not found");
  }
  const releaseListFormatTsvOutput = runChecked(
    ["node", cliPath, "release", "list", "--repo", repositoryId, "--org", organizationId, "--search", releaseTag, "--format", "tsv"],
    {
      cwd: projectRoot,
      env,
      step: "release.list.format.tsv",
    }
  ).stdout.trim();
  if (!releaseListFormatTsvOutput.includes("tagName\tname\tref\tcreatedAt\treleasedAt")) {
    fail("release list --format tsv verification failed: missing tsv header");
  }
  const releaseListOutPath = path.join(tmpRoot, `release-list-${runId}.tsv`);
  runChecked(
    [
      "node",
      cliPath,
      "release",
      "list",
      "--repo",
      repositoryId,
      "--org",
      organizationId,
      "--search",
      releaseTag,
      "--format",
      "tsv",
      "--out",
      releaseListOutPath,
    ],
    {
      cwd: projectRoot,
      env,
      step: "release.list.out.tsv",
    }
  );
  if (!fs.existsSync(releaseListOutPath)) {
    fail("release list --out verification failed: output file not found");
  }
  const releaseListOutText = fs.readFileSync(releaseListOutPath, "utf-8");
  if (!releaseListOutText.includes("tagName\tname\tref\tcreatedAt\treleasedAt")) {
    fail("release list --out verification failed: missing tsv header");
  }
  runExpectedFailure(
    ["node", cliPath, "release", "list", "--repo", repositoryId, "--org", organizationId, "--search", releaseTag, "--format", "bad"],
    {
      cwd: projectRoot,
      env,
      step: "release.list.format.invalid",
      contains: "Invalid --format value",
    }
  );
  runExpectedFailure(
    [
      "node",
      cliPath,
      "release",
      "list",
      "--repo",
      repositoryId,
      "--org",
      organizationId,
      "--search",
      releaseTag,
      "--format",
      "table",
      "--out",
      path.join(tmpRoot, `release-list-invalid-out-${runId}.txt`),
    ],
    {
      cwd: projectRoot,
      env,
      step: "release.list.out.table.invalid",
      contains: "--out` requires --format tsv/json",
    }
  );
  const releaseDeleteFormatJsonTag = `v0.0.0-release-e2e-delete-json-${Date.now()}`;
  runJson(
    [
      "release",
      "create",
      "--repo",
      repositoryId,
      "--org",
      organizationId,
      "--tag",
      releaseDeleteFormatJsonTag,
      "--ref",
      baseBranch,
      "--json",
    ],
    {
      step: "release.delete.format.json.seed",
    }
  );
  const releaseDeleteFormatJson = runJson(
    ["release", "delete", releaseDeleteFormatJsonTag, "--repo", repositoryId, "--org", organizationId, "--yes", "--format", "json"],
    {
      step: "release.delete.format.json",
    }
  );
  if (!isRecord(releaseDeleteFormatJson)) {
    fail("release delete --format json verification failed: invalid response shape");
  }
  const releaseDeleteFormatTsvTag = `v0.0.0-release-e2e-delete-tsv-${Date.now()}`;
  runJson(
    [
      "release",
      "create",
      "--repo",
      repositoryId,
      "--org",
      organizationId,
      "--tag",
      releaseDeleteFormatTsvTag,
      "--ref",
      baseBranch,
      "--json",
    ],
    {
      step: "release.delete.format.tsv.seed",
    }
  );
  const releaseDeleteFormatTsvOutput = runChecked(
    ["node", cliPath, "release", "delete", releaseDeleteFormatTsvTag, "--repo", repositoryId, "--org", organizationId, "--yes", "--format", "tsv"],
    {
      cwd: projectRoot,
      env,
      step: "release.delete.format.tsv",
    }
  ).stdout.trim();
  if (!releaseDeleteFormatTsvOutput.includes("key\tvalue")) {
    fail("release delete --format tsv verification failed: missing tsv header");
  }
  const releaseDeleteOutTag = `v0.0.0-release-e2e-delete-out-${Date.now()}`;
  runJson(
    [
      "release",
      "create",
      "--repo",
      repositoryId,
      "--org",
      organizationId,
      "--tag",
      releaseDeleteOutTag,
      "--ref",
      baseBranch,
      "--json",
    ],
    {
      step: "release.delete.out.seed",
    }
  );
  const releaseDeleteOutPath = path.join(tmpRoot, `release-delete-${runId}.tsv`);
  runChecked(
    [
      "node",
      cliPath,
      "release",
      "delete",
      releaseDeleteOutTag,
      "--repo",
      repositoryId,
      "--org",
      organizationId,
      "--yes",
      "--format",
      "tsv",
      "--out",
      releaseDeleteOutPath,
    ],
    {
      cwd: projectRoot,
      env,
      step: "release.delete.out.tsv",
    }
  );
  if (!fs.existsSync(releaseDeleteOutPath)) {
    fail("release delete --out verification failed: output file not found");
  }
  const releaseDeleteOutText = fs.readFileSync(releaseDeleteOutPath, "utf-8");
  if (!releaseDeleteOutText.includes("key\tvalue")) {
    fail("release delete --out verification failed: missing tsv header");
  }
  runExpectedFailure(
    ["node", cliPath, "release", "delete", releaseTag, "--repo", repositoryId, "--org", organizationId, "--yes", "--format", "bad"],
    {
      cwd: projectRoot,
      env,
      step: "release.delete.format.invalid",
      contains: "Invalid --format value",
    }
  );
  runExpectedFailure(
    [
      "node",
      cliPath,
      "release",
      "delete",
      releaseTag,
      "--repo",
      repositoryId,
      "--org",
      organizationId,
      "--yes",
      "--format",
      "table",
      "--out",
      path.join(tmpRoot, `release-delete-invalid-out-${runId}.txt`),
    ],
    {
      cwd: projectRoot,
      env,
      step: "release.delete.out.table.invalid",
      contains: "--out` requires --format tsv/json",
    }
  );
  runJson(["release", "delete", releaseTag, "--repo", repositoryId, "--org", organizationId, "--yes", "--json"], {
    step: "release.delete",
  });
  createdReleaseTag = undefined;
  note("release", "create/view/list/delete + format/out");

  const labelName = `e2e-label-${Date.now()}`;
  const renamedLabelName = `${labelName}-edited`;
  createdLabelName = labelName;
  const labelSoftFrom = structuredStepReport.length;
  try {
    runJson(["label", "list", "--repo", repositoryId, "--org", organizationId, "--json"], {
      step: "label.list.before",
    });
    const labelListFormatJson = runJson(["label", "list", "--repo", repositoryId, "--org", organizationId, "--format", "json"], {
      step: "label.list.format.json",
    });
    if (!isRecord(labelListFormatJson) || !Array.isArray(labelListFormatJson.labels)) {
      fail("label list --format json verification failed: invalid response shape");
    }
    const labelListFormatTsvOutput = runChecked(
      ["node", cliPath, "label", "list", "--repo", repositoryId, "--org", organizationId, "--format", "tsv"],
      {
        cwd: projectRoot,
        env,
        step: "label.list.format.tsv",
      }
    ).stdout.trim();
    if (!labelListFormatTsvOutput) {
      fail("label list --format tsv verification failed: empty output");
    }
    const labelListOutPath = path.join(tmpRoot, `label-list-${runId}.tsv`);
    runChecked(
      ["node", cliPath, "label", "list", "--repo", repositoryId, "--org", organizationId, "--format", "tsv", "--out", labelListOutPath],
      {
        cwd: projectRoot,
        env,
        step: "label.list.out.tsv",
      }
    );
    if (!fs.existsSync(labelListOutPath)) {
      fail("label list --out verification failed: output file not found");
    }
    runExpectedFailure(
      ["node", cliPath, "label", "list", "--repo", repositoryId, "--org", organizationId, "--format", "bad"],
      {
        cwd: projectRoot,
        env,
        step: "label.list.format.invalid",
        contains: "Invalid --format value",
      }
    );
    runExpectedFailure(
      [
        "node",
        cliPath,
        "label",
        "list",
        "--repo",
        repositoryId,
        "--org",
        organizationId,
        "--format",
        "table",
        "--out",
        path.join(tmpRoot, `label-list-invalid-out-${runId}.txt`),
      ],
      {
        cwd: projectRoot,
        env,
        step: "label.list.out.table.invalid",
        contains: "--out` requires --format tsv/json",
      }
    );
    runExpectedFailure(["node", cliPath, "label", "create", labelName, "--repo", repositoryId, "--org", organizationId, "--format", "bad"], {
      cwd: projectRoot,
      env,
      step: "label.create.format.invalid",
      contains: "Invalid --format value",
    });
    runExpectedFailure(
      [
        "node",
        cliPath,
        "label",
        "create",
        labelName,
        "--repo",
        repositoryId,
        "--org",
        organizationId,
        "--format",
        "table",
        "--out",
        path.join(tmpRoot, `label-create-invalid-out-${runId}.txt`),
      ],
      {
        cwd: projectRoot,
        env,
        step: "label.create.out.table.invalid",
        contains: "--out` requires --format tsv/json",
      }
    );
    runExpectedFailure(
      [
        "node",
        cliPath,
        "label",
        "edit",
        labelName,
        "--repo",
        repositoryId,
        "--org",
        organizationId,
        "--name",
        renamedLabelName,
        "--format",
        "bad",
      ],
      {
        cwd: projectRoot,
        env,
        step: "label.edit.format.invalid",
        contains: "Invalid --format value",
      }
    );
    runExpectedFailure(
      [
        "node",
        cliPath,
        "label",
        "edit",
        labelName,
        "--repo",
        repositoryId,
        "--org",
        organizationId,
        "--name",
        renamedLabelName,
        "--format",
        "table",
        "--out",
        path.join(tmpRoot, `label-edit-invalid-out-${runId}.txt`),
      ],
      {
        cwd: projectRoot,
        env,
        step: "label.edit.out.table.invalid",
        contains: "--out` requires --format tsv/json",
      }
    );
    runExpectedFailure(
      [
        "node",
        cliPath,
        "label",
        "delete",
        labelName,
        "--repo",
        repositoryId,
        "--org",
        organizationId,
        "--yes",
        "--format",
        "bad",
      ],
      {
        cwd: projectRoot,
        env,
        step: "label.delete.format.invalid",
        contains: "Invalid --format value",
      }
    );
    runExpectedFailure(
      [
        "node",
        cliPath,
        "label",
        "delete",
        labelName,
        "--repo",
        repositoryId,
        "--org",
        organizationId,
        "--yes",
        "--format",
        "table",
        "--out",
        path.join(tmpRoot, `label-delete-invalid-out-${runId}.txt`),
      ],
      {
        cwd: projectRoot,
        env,
        step: "label.delete.out.table.invalid",
        contains: "--out` requires --format tsv/json",
      }
    );
    runExpectedFailure(["node", cliPath, "label", "add", "0", "x", "--org", organizationId, "--format", "bad"], {
      cwd: projectRoot,
      env,
      step: "label.add.format.invalid",
      contains: "Invalid --format value",
    });
    runExpectedFailure(
      ["node", cliPath, "label", "add", "0", "x", "--org", organizationId, "--format", "table", "--out", path.join(tmpRoot, `label-add-invalid-out-${runId}.txt`)],
      {
        cwd: projectRoot,
        env,
        step: "label.add.out.table.invalid",
        contains: "--out` requires --format tsv/json",
      }
    );
    runExpectedFailure(["node", cliPath, "label", "remove", "0", "x", "--org", organizationId, "--format", "bad"], {
      cwd: projectRoot,
      env,
      step: "label.remove.format.invalid",
      contains: "Invalid --format value",
    });
    runExpectedFailure(
      ["node", cliPath, "label", "remove", "0", "x", "--org", organizationId, "--format", "table", "--out", path.join(tmpRoot, `label-remove-invalid-out-${runId}.txt`)],
      {
        cwd: projectRoot,
        env,
        step: "label.remove.out.table.invalid",
        contains: "--out` requires --format tsv/json",
      }
    );
    runJson(
      [
        "label",
        "create",
        labelName,
        "--repo",
        repositoryId,
        "--org",
        organizationId,
        "--color",
        "336699",
        "--description",
        "created by e2e smoke",
        "--json",
      ],
      {
        step: "label.create",
      }
    );
    runJson(
      [
        "label",
        "edit",
        labelName,
        "--repo",
        repositoryId,
        "--org",
        organizationId,
        "--name",
        renamedLabelName,
        "--color",
        "4477aa",
        "--description",
        "updated by e2e smoke",
        "--json",
      ],
      {
        step: "label.edit",
      }
    );
    const labelsAfterEdit = runJson(["label", "list", "--repo", repositoryId, "--org", organizationId, "--json"], {
      step: "label.list.after-edit",
    });
    if (!hasRepositoryLabel(labelsAfterEdit, renamedLabelName)) {
      fail("label edit verification failed: renamed label not found");
    }
    runJson(["label", "delete", renamedLabelName, "--repo", repositoryId, "--org", organizationId, "--yes", "--json"], {
      step: "label.delete",
    });
    createdLabelName = undefined;
    note("label", "list/list-format/list-out/create/edit/delete (+ invalid)");
  } catch (error) {
    for (let i = labelSoftFrom; i < structuredStepReport.length; i += 1) {
      const item = structuredStepReport[i];
      if (item && item.step && String(item.step).startsWith("label.") && item.status === "FAIL") {
        item.status = "SOFT_FAIL";
      }
    }
    createdLabelName = undefined;
    warnings.push(`label lifecycle skipped: ${sanitizeText(error instanceof Error ? error.message : String(error))}`);
  }

  orgSecretName = `e2e-org-secret-${Date.now()}`;
  repoSecretName = `e2e-repo-secret-${Date.now()}`;
  pipelineSecretName = `e2e-pipeline-secret-${Date.now()}`;
  pipelineScopeId = `e2e-pipeline-${Date.now()}`;
  runJson(
    [
      "secret",
      "set",
      orgSecretName,
      "--org",
      organizationId,
      "--scope",
      "org",
      "--value",
      `org-${Date.now()}`,
      "--json",
    ],
    { step: "secret.set.org.create" }
  );
  runJson(
    [
      "secret",
      "set",
      orgSecretName,
      "--org",
      organizationId,
      "--scope",
      "org",
      "--value",
      `org-updated-${Date.now()}`,
      "--json",
    ],
    { step: "secret.set.org.update" }
  );
  const orgSecretList = runJson(["secret", "list", "--org", organizationId, "--scope", "org", "--json"], {
    step: "secret.list.org",
  });
  if (!hasSecret(orgSecretList, orgSecretName, "org")) {
    fail("secret org verification failed: secret not found in list");
  }

  runJson(
    [
      "secret",
      "set",
      repoSecretName,
      "--org",
      organizationId,
      "--scope",
      "repo",
      "--repo",
      repositoryId,
      "--value",
      `repo-${Date.now()}`,
      "--json",
    ],
    { step: "secret.set.repo" }
  );
  const repoSecretList = runJson(
    ["secret", "list", "--org", organizationId, "--scope", "repo", "--repo", repositoryId, "--json"],
    {
      step: "secret.list.repo",
    }
  );
  if (!hasSecret(repoSecretList, repoSecretName, "repo")) {
    fail("secret repo verification failed: secret not found in list");
  }

  runJson(
    [
      "secret",
      "set",
      pipelineSecretName,
      "--org",
      organizationId,
      "--scope",
      "pipeline",
      "--pipeline",
      pipelineScopeId,
      "--value",
      `pipeline-${Date.now()}`,
      "--json",
    ],
    { step: "secret.set.pipeline" }
  );
  const pipelineSecretList = runJson(
    [
      "secret",
      "list",
      "--org",
      organizationId,
      "--scope",
      "pipeline",
      "--pipeline",
      pipelineScopeId,
      "--json",
    ],
    {
      step: "secret.list.pipeline",
    }
  );
  if (!hasSecret(pipelineSecretList, pipelineSecretName, "pipeline")) {
    fail("secret pipeline verification failed: secret not found in list");
  }

  runJson(["secret", "delete", orgSecretName, "--org", organizationId, "--scope", "org", "--json"], {
    step: "secret.delete.org",
  });
  orgSecretName = undefined;
  runJson(
    ["secret", "delete", repoSecretName, "--org", organizationId, "--scope", "repo", "--repo", repositoryId, "--json"],
    {
      step: "secret.delete.repo",
    }
  );
  repoSecretName = undefined;
  runJson(
    [
      "secret",
      "delete",
      pipelineSecretName,
      "--org",
      organizationId,
      "--scope",
      "pipeline",
      "--pipeline",
      pipelineScopeId,
      "--json",
    ],
    {
      step: "secret.delete.pipeline",
    }
  );
  pipelineSecretName = undefined;
  note("secret", "set(list/update)/list/delete for org+repo+pipeline");

  const featureBranch = `feat/e2e-${Date.now()}`;
  writeText(path.join(clonePath, "e2e.txt"), `e2e at ${new Date().toISOString()}${os.EOL}`);
  runChecked(["git", "-C", clonePath, "checkout", "-b", featureBranch], {
    step: "git.checkout",
  });
  runChecked(["git", "-C", clonePath, "add", "e2e.txt"], { step: "git.add" });
  runChecked(["git", "-C", clonePath, "commit", "-m", "test: e2e smoke commit"], {
    step: "git.commit",
  });
  runChecked(
    [
      "git",
      "-C",
      clonePath,
      "-c",
      `http.extraHeader=x-yunxiao-token: ${token}`,
      "push",
      "-u",
      "origin",
      featureBranch,
    ],
    { step: "git.push" }
  );
  featureHeadSha = runChecked(["git", "-C", clonePath, "rev-parse", "HEAD"], {
    step: "git.rev-parse.head",
  }).stdout.trim();
  if (!featureHeadSha) {
    fail("Unable to resolve feature branch HEAD SHA.");
  }
  note("git.push", `${baseBranch} + ${featureBranch}`);

  const createdPr = runJson(
    [
      "pr",
      "create",
      "--repo",
      repositoryId,
      "--org",
      organizationId,
      "--source",
      featureBranch,
      "--target",
      baseBranch,
      "--title",
      "e2e smoke pr",
      "--description",
      "created by scripts/e2e-smoke.mjs",
      "--format",
      "json",
    ],
    { step: "pr.create" }
  );
  localId = readFirstString(createdPr, ["localId", "iid", "result.localId", "result.iid"]);
  if (!localId) {
    fail("pr create returned no local id");
  }
  note("pr.create", localId);
  const createFormatTsvBranch = `feat/e2e-create-tsv-${Date.now()}`;
  const createFormatTsvFile = `e2e-create-tsv-${Date.now()}.txt`;
  runChecked(["git", "-C", clonePath, "checkout", baseBranch], {
    step: "git.create-tsv.checkout-base",
  });
  writeText(path.join(clonePath, createFormatTsvFile), `create tsv at ${new Date().toISOString()}${os.EOL}`);
  runChecked(["git", "-C", clonePath, "checkout", "-b", createFormatTsvBranch], {
    step: "git.create-tsv.checkout-feature",
  });
  runChecked(["git", "-C", clonePath, "add", createFormatTsvFile], { step: "git.create-tsv.add" });
  runChecked(["git", "-C", clonePath, "commit", "-m", "test: e2e create tsv commit"], {
    step: "git.create-tsv.commit",
  });
  runChecked(
    [
      "git",
      "-C",
      clonePath,
      "-c",
      `http.extraHeader=x-yunxiao-token: ${token}`,
      "push",
      "-u",
      "origin",
      createFormatTsvBranch,
    ],
    { step: "git.create-tsv.push" }
  );
  const prCreateFormatTsvOutput = runChecked(
    [
      "node",
      cliPath,
      "pr",
      "create",
      "--repo",
      repositoryId,
      "--org",
      organizationId,
      "--source",
      createFormatTsvBranch,
      "--target",
      baseBranch,
      "--title",
      `e2e smoke pr create tsv ${runId}`,
      "--description",
      "created by scripts/e2e-smoke.mjs for tsv format",
      "--format",
      "tsv",
    ],
    {
      cwd: projectRoot,
      env,
      step: "pr.create.format.tsv",
    }
  ).stdout.trim();
  if (!prCreateFormatTsvOutput.includes("key\tvalue")) {
    fail("pr create --format tsv verification failed: missing tsv header");
  }
  const createOutBranch = `feat/e2e-create-out-${Date.now()}`;
  const createOutFile = `e2e-create-out-${Date.now()}.txt`;
  runChecked(["git", "-C", clonePath, "checkout", baseBranch], {
    step: "git.create-out.checkout-base",
  });
  writeText(path.join(clonePath, createOutFile), `create out at ${new Date().toISOString()}${os.EOL}`);
  runChecked(["git", "-C", clonePath, "checkout", "-b", createOutBranch], {
    step: "git.create-out.checkout-feature",
  });
  runChecked(["git", "-C", clonePath, "add", createOutFile], { step: "git.create-out.add" });
  runChecked(["git", "-C", clonePath, "commit", "-m", "test: e2e create out commit"], {
    step: "git.create-out.commit",
  });
  runChecked(
    [
      "git",
      "-C",
      clonePath,
      "-c",
      `http.extraHeader=x-yunxiao-token: ${token}`,
      "push",
      "-u",
      "origin",
      createOutBranch,
    ],
    { step: "git.create-out.push" }
  );
  const prCreateOutPath = path.join(tmpRoot, `pr-create-${runId}.tsv`);
  runChecked(
    [
      "node",
      cliPath,
      "pr",
      "create",
      "--repo",
      repositoryId,
      "--org",
      organizationId,
      "--source",
      createOutBranch,
      "--target",
      baseBranch,
      "--title",
      `e2e smoke pr create out ${runId}`,
      "--description",
      "created by scripts/e2e-smoke.mjs for out mode",
      "--format",
      "tsv",
      "--out",
      prCreateOutPath,
    ],
    {
      cwd: projectRoot,
      env,
      step: "pr.create.out.tsv",
    }
  );
  if (!fs.existsSync(prCreateOutPath)) {
    fail("pr create --out verification failed: output file not found");
  }
  const prCreateOutText = fs.readFileSync(prCreateOutPath, "utf-8");
  if (!prCreateOutText.includes("key\tvalue")) {
    fail("pr create --out verification failed: missing tsv header");
  }
  runExpectedFailure(
    [
      "node",
      cliPath,
      "pr",
      "create",
      "--repo",
      repositoryId,
      "--org",
      organizationId,
      "--source",
      featureBranch,
      "--target",
      baseBranch,
      "--title",
      `e2e smoke pr create invalid format ${runId}`,
      "--description",
      "invalid format verification",
      "--format",
      "bad",
    ],
    {
      cwd: projectRoot,
      env,
      step: "pr.create.format.invalid",
      contains: "Invalid --format value",
    }
  );
  runExpectedFailure(
    [
      "node",
      cliPath,
      "pr",
      "create",
      "--repo",
      repositoryId,
      "--org",
      organizationId,
      "--source",
      featureBranch,
      "--target",
      baseBranch,
      "--title",
      `e2e smoke pr create invalid out ${runId}`,
      "--description",
      "invalid out verification",
      "--format",
      "table",
      "--out",
      path.join(tmpRoot, `pr-create-invalid-out-${runId}.txt`),
    ],
    {
      cwd: projectRoot,
      env,
      step: "pr.create.out.table.invalid",
      contains: "--out` requires --format tsv/json",
    }
  );
  const apiPatchSoftFrom = structuredStepReport.length;
  try {
    runJson(
      [
        "api",
        "patch",
        `/oapi/v1/codeup/organizations/${organizationId}/repositories/${repositoryId}/changeRequests/${localId}`,
        "--body",
        JSON.stringify({
          description: "updated by e2e api.patch",
        }),
        "--json",
      ],
      {
        step: "api.patch.change-request",
      }
    );
    note("api.patch", "change-request");
  } catch (error) {
    for (let i = apiPatchSoftFrom; i < structuredStepReport.length; i += 1) {
      const item = structuredStepReport[i];
      if (item && item.step && String(item.step).startsWith("api.patch.") && item.status === "FAIL") {
        item.status = "SOFT_FAIL";
      }
    }
    warnings.push(`api.patch skipped: ${sanitizeText(error instanceof Error ? error.message : String(error))}`);
  }

  const commitStatusContext = `e2e-status-${Date.now()}`;
  const pendingCommitStatus = runJson(
    [
      "repo",
      "commit-status",
      "create",
      repositoryId,
      featureHeadSha,
      "--org",
      organizationId,
      "--context",
      commitStatusContext,
      "--state",
      "pending",
      "--description",
      "e2e pending",
      "--target-url",
      "https://example.com/e2e/pending",
      "--json",
    ],
    {
      step: "repo.commit-status.create.pending",
    }
  );
  const successCommitStatus = runJson(
    [
      "repo",
      "commit-status",
      "create",
      repositoryId,
      featureHeadSha,
      "--org",
      organizationId,
      "--context",
      commitStatusContext,
      "--state",
      "success",
      "--description",
      "e2e success",
      "--target-url",
      "https://example.com/e2e/success",
      "--json",
    ],
    {
      step: "repo.commit-status.create.success",
    }
  );
  const commitStatuses = runJson(
    ["repo", "commit-status", "list", repositoryId, featureHeadSha, "--org", organizationId, "--json"],
    {
      step: "repo.commit-status.list",
    }
  );
  if (!hasCommitStatus(commitStatuses, commitStatusContext)) {
    fail("repo commit-status verification failed: expected context not found.");
  }
  note("repo.commit-status", "create(pending/success)+list");

  const repoMembers = runJson(["repo", "member", "list", repositoryId, "--org", organizationId, "--json"], {
    step: "repo.member.list",
  });
  const memberUserId =
    readFirstString(pendingCommitStatus, ["author.id", "author.userId"]) ??
    readFirstString(successCommitStatus, ["author.id", "author.userId"]);
  if (memberUserId) {
    runJson(["repo", "member", "clone-username", memberUserId, "--org", organizationId, "--json"], {
      step: "repo.member.clone-username",
    });
    note("repo.member", "list+clone-username");
  } else if (!extractRecordArray(repoMembers).length) {
    warnings.push("repo member tests skipped: unable to resolve user id for clone-username.");
  }

  const checkRunName = `e2e-check-${Date.now()}`;
  const createdCheckRun = runJson(
    [
      "repo",
      "check-run",
      "create",
      repositoryId,
      "--org",
      organizationId,
      "--name",
      checkRunName,
      "--head-sha",
      featureHeadSha,
      "--status",
      "in_progress",
      "--title",
      "e2e check run",
      "--summary",
      "created by e2e smoke",
      "--text",
      "in progress",
      "--json",
    ],
    {
      step: "repo.check-run.create",
    }
  );
  const checkRunId = readFirstString(createdCheckRun, ["id", "result.id"]);
  if (!checkRunId) {
    fail("repo check-run create returned no checkRunId");
  }
  runJson(["repo", "check-run", "view", repositoryId, checkRunId, "--org", organizationId, "--json"], {
    step: "repo.check-run.view",
  });
  runJson(
    [
      "repo",
      "check-run",
      "update",
      repositoryId,
      checkRunId,
      "--org",
      organizationId,
      "--status",
      "completed",
      "--conclusion",
      "success",
      "--title",
      "e2e check run",
      "--summary",
      "updated by e2e smoke",
      "--text",
      "completed",
      "--json",
    ],
    {
      step: "repo.check-run.update",
    }
  );
  const checkRunList = runJson(
    ["repo", "check-run", "list", repositoryId, "--org", organizationId, "--ref", featureHeadSha, "--json"],
    {
      step: "repo.check-run.list",
    }
  );
  if (!hasCheckRun(checkRunList, checkRunId, checkRunName)) {
    fail("repo check-run verification failed: created check run not found in list.");
  }
  note("repo.check-run", "create/view/update/list");

  const webhookUrl = `https://example.com/yx-e2e-webhook-${Date.now()}`;
  const createdWebhook = runJson(
    [
      "repo",
      "webhook",
      "create",
      repositoryId,
      "--org",
      organizationId,
      "--url",
      webhookUrl,
      "--description",
      "e2e webhook",
      "--enable-ssl-verification",
      "true",
      "--push-events",
      "true",
      "--merge-requests-events",
      "true",
      "--note-events",
      "false",
      "--tag-push-events",
      "false",
      "--json",
    ],
    {
      step: "repo.webhook.create",
    }
  );
  webhookId = readFirstString(createdWebhook, ["id", "result.id"]);
  if (!webhookId) {
    fail("repo webhook create returned no hookId");
  }
  runJson(["repo", "webhook", "view", repositoryId, webhookId, "--org", organizationId, "--json"], {
    step: "repo.webhook.view",
  });
  runJson(
    ["api", "get", `/oapi/v1/codeup/organizations/${organizationId}/repositories/${repositoryId}/webhooks/${webhookId}`, "--json"],
    {
      step: "api.get.webhook",
    }
  );
  const webhookList = runJson(["repo", "webhook", "list", repositoryId, "--org", organizationId, "--json"], {
    step: "repo.webhook.list",
  });
  if (!hasWebhook(webhookList, webhookId)) {
    fail("repo webhook verification failed: created webhook not found in list.");
  }
  runJson(
    [
      "repo",
      "webhook",
      "update",
      repositoryId,
      webhookId,
      "--org",
      organizationId,
      "--description",
      "e2e webhook updated",
      "--push-events",
      "true",
      "--merge-requests-events",
      "true",
      "--note-events",
      "true",
      "--tag-push-events",
      "false",
      "--json",
    ],
    {
      step: "repo.webhook.update",
    }
  );
  runJson(
    [
      "api",
      "put",
      `/oapi/v1/codeup/organizations/${organizationId}/repositories/${repositoryId}/webhooks/${webhookId}`,
      "--body",
      JSON.stringify({
        description: "e2e webhook updated via api.put",
        enableSslVerification: true,
        mergeRequestsEvents: true,
        noteEvents: true,
        pushEvents: true,
        tagPushEvents: false,
        url: webhookUrl,
      }),
      "--json",
    ],
    {
      step: "api.put.webhook",
    }
  );
  runJson(["repo", "webhook", "delete", repositoryId, webhookId, "--org", organizationId, "--yes", "--json"], {
    step: "repo.webhook.delete",
  });
  webhookId = undefined;
  const apiWebhookUrl = `https://example.com/yx-e2e-webhook-api-delete-${Date.now()}`;
  const apiDeleteWebhook = runJson(
    [
      "repo",
      "webhook",
      "create",
      repositoryId,
      "--org",
      organizationId,
      "--url",
      apiWebhookUrl,
      "--description",
      "e2e webhook api delete",
      "--enable-ssl-verification",
      "true",
      "--push-events",
      "true",
      "--merge-requests-events",
      "false",
      "--note-events",
      "false",
      "--tag-push-events",
      "false",
      "--json",
    ],
    {
      step: "repo.webhook.create.for-api-delete",
    }
  );
  const apiDeleteWebhookId = readFirstString(apiDeleteWebhook, ["id", "result.id"]);
  if (!apiDeleteWebhookId) {
    fail("repo webhook create(for api.delete) returned no hookId");
  }
  webhookId = apiDeleteWebhookId;
  runJson(
    [
      "api",
      "delete",
      `/oapi/v1/codeup/organizations/${organizationId}/repositories/${repositoryId}/webhooks/${apiDeleteWebhookId}`,
      "--json",
    ],
    {
      step: "api.delete.webhook",
    }
  );
  webhookId = undefined;
  note("repo.webhook", "create/view/list/update/delete (+ raw api get/put/delete)");

  const prCheckoutResult = runJson(
    [
      "pr",
      "checkout",
      repositoryId,
      localId,
      "--org",
      organizationId,
      "--repo-dir",
      clonePath,
      "--dry-run",
      "--format",
      "json",
    ],
    { step: "pr.checkout.format.json" }
  );
  if (
    !isRecord(prCheckoutResult) ||
    prCheckoutResult.executed !== false ||
    !Array.isArray(prCheckoutResult.commands)
  ) {
    fail("pr checkout --format json verification failed: invalid response shape");
  }
  const prCheckoutTsvOutput = runChecked(
    [
      "node",
      cliPath,
      "pr",
      "checkout",
      repositoryId,
      localId,
      "--org",
      organizationId,
      "--repo-dir",
      clonePath,
      "--dry-run",
      "--format",
      "tsv",
    ],
    {
      cwd: projectRoot,
      env,
      step: "pr.checkout.format.tsv",
    }
  ).stdout.trim();
  if (!prCheckoutTsvOutput.includes("key\tvalue")) {
    fail("pr checkout --format tsv verification failed: missing tsv header");
  }
  const prCheckoutOutPath = path.join(tmpRoot, `pr-checkout-${runId}.tsv`);
  runChecked(
    [
      "node",
      cliPath,
      "pr",
      "checkout",
      repositoryId,
      localId,
      "--org",
      organizationId,
      "--repo-dir",
      clonePath,
      "--dry-run",
      "--format",
      "tsv",
      "--out",
      prCheckoutOutPath,
    ],
    {
      cwd: projectRoot,
      env,
      step: "pr.checkout.out.tsv",
    }
  );
  if (!fs.existsSync(prCheckoutOutPath)) {
    fail("pr checkout --out verification failed: output file not found");
  }
  const prCheckoutOutText = fs.readFileSync(prCheckoutOutPath, "utf-8");
  if (!prCheckoutOutText.includes("key\tvalue")) {
    fail("pr checkout --out verification failed: missing tsv header");
  }
  runExpectedFailure(
    [
      "node",
      cliPath,
      "pr",
      "checkout",
      repositoryId,
      localId,
      "--org",
      organizationId,
      "--repo-dir",
      clonePath,
      "--dry-run",
      "--format",
      "bad",
    ],
    {
      cwd: projectRoot,
      env,
      step: "pr.checkout.format.invalid",
      contains: "Invalid --format value",
    }
  );
  runExpectedFailure(
    [
      "node",
      cliPath,
      "pr",
      "checkout",
      repositoryId,
      localId,
      "--org",
      organizationId,
      "--repo-dir",
      clonePath,
      "--dry-run",
      "--format",
      "table",
      "--out",
      path.join(tmpRoot, `pr-checkout-invalid-out-${runId}.txt`),
    ],
    {
      cwd: projectRoot,
      env,
      step: "pr.checkout.out.table.invalid",
      contains: "--out` requires --format tsv/json",
    }
  );

  const prViewResult = runJson(["pr", "view", repositoryId, localId, "--org", organizationId, "--json"], {
    step: "pr.view",
  });
  if (!isRecord(prViewResult) || typeof prViewResult.localId !== "number") {
    fail("pr view verification failed: invalid response shape");
  }
  const prViewFormatJson = runJson(
    ["pr", "view", repositoryId, localId, "--org", organizationId, "--format", "json"],
    {
      step: "pr.view.format.json",
    }
  );
  if (!isRecord(prViewFormatJson) || typeof prViewFormatJson.localId !== "number") {
    fail("pr view --format json verification failed: invalid response shape");
  }
  const prViewFormatTsvOutput = runChecked(
    ["node", cliPath, "pr", "view", repositoryId, localId, "--org", organizationId, "--format", "tsv"],
    {
      cwd: projectRoot,
      env,
      step: "pr.view.format.tsv",
    }
  ).stdout.trim();
  if (!prViewFormatTsvOutput.includes("key\tvalue")) {
    fail("pr view --format tsv verification failed: missing tsv header");
  }
  const prViewOutPath = path.join(tmpRoot, `pr-view-${runId}.tsv`);
  runChecked(
    [
      "node",
      cliPath,
      "pr",
      "view",
      repositoryId,
      localId,
      "--org",
      organizationId,
      "--format",
      "tsv",
      "--out",
      prViewOutPath,
    ],
    {
      cwd: projectRoot,
      env,
      step: "pr.view.out.tsv",
    }
  );
  if (!fs.existsSync(prViewOutPath)) {
    fail("pr view --out verification failed: output file not found");
  }
  const prViewOutText = fs.readFileSync(prViewOutPath, "utf-8");
  if (!prViewOutText.includes("key\tvalue")) {
    fail("pr view --out verification failed: missing tsv header");
  }
  runExpectedFailure(
    ["node", cliPath, "pr", "view", repositoryId, localId, "--org", organizationId, "--format", "bad"],
    {
      cwd: projectRoot,
      env,
      step: "pr.view.format.invalid",
      contains: "Invalid --format value",
    }
  );
  runExpectedFailure(
    [
      "node",
      cliPath,
      "pr",
      "view",
      repositoryId,
      localId,
      "--org",
      organizationId,
      "--format",
      "table",
      "--out",
      path.join(tmpRoot, `pr-view-invalid-out-${runId}.txt`),
    ],
    {
      cwd: projectRoot,
      env,
      step: "pr.view.out.table.invalid",
      contains: "--out` requires --format tsv/json",
    }
  );
  const prListResult = runJson(["pr", "list", "--repo", repositoryId, "--org", organizationId, "--json"], {
    step: "pr.list",
  });
  if (!Array.isArray(prListResult) || prListResult.length === 0) {
    fail("pr list verification failed: expected non-empty list");
  }
  const prListFormatJsonResult = runJson(
    ["pr", "list", "--repo", repositoryId, "--org", organizationId, "--format", "json"],
    {
      step: "pr.list.format.json",
    }
  );
  if (!Array.isArray(prListFormatJsonResult)) {
    fail("pr list --format json verification failed: invalid response shape");
  }
  const prListFormatTsvOutput = runChecked(
    ["node", cliPath, "pr", "list", "--repo", repositoryId, "--org", organizationId, "--format", "tsv"],
    {
      cwd: projectRoot,
      env,
      step: "pr.list.format.tsv",
    }
  ).stdout.trim();
  if (!prListFormatTsvOutput.includes("localId\ttitle\tstate")) {
    fail("pr list --format tsv verification failed: missing tsv header");
  }
  const prListOutPath = path.join(tmpRoot, `pr-list-${runId}.tsv`);
  runChecked(
    [
      "node",
      cliPath,
      "pr",
      "list",
      "--repo",
      repositoryId,
      "--org",
      organizationId,
      "--format",
      "tsv",
      "--out",
      prListOutPath,
    ],
    {
      cwd: projectRoot,
      env,
      step: "pr.list.out.tsv",
    }
  );
  if (!fs.existsSync(prListOutPath)) {
    fail("pr list --out verification failed: output file not found");
  }
  const prListOutText = fs.readFileSync(prListOutPath, "utf-8");
  if (!prListOutText.includes("localId\ttitle\tstate")) {
    fail("pr list --out verification failed: missing tsv header");
  }
  runExpectedFailure(
    ["node", cliPath, "pr", "list", "--repo", repositoryId, "--org", organizationId, "--format", "bad"],
    {
      cwd: projectRoot,
      env,
      step: "pr.list.format.invalid",
      contains: "Invalid --format value",
    }
  );
  runExpectedFailure(
    [
      "node",
      cliPath,
      "pr",
      "list",
      "--repo",
      repositoryId,
      "--org",
      organizationId,
      "--format",
      "table",
      "--out",
      path.join(tmpRoot, `pr-list-invalid-out-${runId}.txt`),
    ],
    {
      cwd: projectRoot,
      env,
      step: "pr.list.out.table.invalid",
      contains: "--out` requires --format tsv/json",
    }
  );
  const prStatusResult = runJson(["pr", "status", "--repo", repositoryId, "--org", organizationId, "--json"], {
    step: "pr.status",
  });
  if (
    !isRecord(prStatusResult) ||
    typeof prStatusResult.currentUserId !== "string" ||
    !isRecord(prStatusResult.authored) ||
    !Array.isArray(prStatusResult.authored.open) ||
    !isRecord(prStatusResult.reviewRequested) ||
    !Array.isArray(prStatusResult.reviewRequested.open)
  ) {
    fail("pr status verification failed: invalid response shape");
  }
  const prStatusFormatJsonResult = runJson(
    ["pr", "status", "--repo", repositoryId, "--org", organizationId, "--format", "json"],
    {
      step: "pr.status.format.json",
    }
  );
  if (!isRecord(prStatusFormatJsonResult) || !isRecord(prStatusFormatJsonResult.authored)) {
    fail("pr status --format json verification failed: invalid response shape");
  }
  const prStatusFormatTsvOutput = runChecked(
    ["node", cliPath, "pr", "status", "--repo", repositoryId, "--org", organizationId, "--format", "tsv"],
    {
      cwd: projectRoot,
      env,
      step: "pr.status.format.tsv",
    }
  ).stdout.trim();
  if (!prStatusFormatTsvOutput.includes("section\tlocalId\ttitle")) {
    fail("pr status --format tsv verification failed: missing tsv header");
  }
  const prStatusOutPath = path.join(tmpRoot, `pr-status-${runId}.tsv`);
  runChecked(
    [
      "node",
      cliPath,
      "pr",
      "status",
      "--repo",
      repositoryId,
      "--org",
      organizationId,
      "--format",
      "tsv",
      "--out",
      prStatusOutPath,
    ],
    {
      cwd: projectRoot,
      env,
      step: "pr.status.out.tsv",
    }
  );
  if (!fs.existsSync(prStatusOutPath)) {
    fail("pr status --out verification failed: output file not found");
  }
  const prStatusOutText = fs.readFileSync(prStatusOutPath, "utf-8");
  if (!prStatusOutText.includes("section\tlocalId\ttitle")) {
    fail("pr status --out verification failed: missing tsv header");
  }
  runExpectedFailure(
    ["node", cliPath, "pr", "status", "--repo", repositoryId, "--org", organizationId, "--format", "bad"],
    {
      cwd: projectRoot,
      env,
      step: "pr.status.format.invalid",
      contains: "Invalid --format value",
    }
  );
  runExpectedFailure(
    [
      "node",
      cliPath,
      "pr",
      "status",
      "--repo",
      repositoryId,
      "--org",
      organizationId,
      "--format",
      "table",
      "--out",
      path.join(tmpRoot, `pr-status-invalid-out-${runId}.txt`),
    ],
    {
      cwd: projectRoot,
      env,
      step: "pr.status.out.table.invalid",
      contains: "--out` requires --format tsv/json",
    }
  );
  const prCommentResult = runJson(
    ["pr", "comment", repositoryId, localId, "--org", organizationId, "--body", "e2e comment", "--json"],
    {
      step: "pr.comment",
    }
  );
  const prCommentBizId = readFirstString(prCommentResult, [
    "comment_biz_id",
    "commentBizId",
    "id",
    "bizId",
  ]);
  if (!prCommentBizId) {
    fail("pr comment verification failed: comment biz id not found");
  }
  const prCommentFormatJsonResult = runJson(
    ["pr", "comment", repositoryId, localId, "--org", organizationId, "--body", "e2e comment format json", "--format", "json"],
    {
      step: "pr.comment.format.json",
    }
  );
  if (!isRecord(prCommentFormatJsonResult) || !readFirstString(prCommentFormatJsonResult, ["comment_biz_id", "commentBizId", "id"])) {
    fail("pr comment --format json verification failed: invalid response shape");
  }
  const prCommentFormatTsvOutput = runChecked(
    ["node", cliPath, "pr", "comment", repositoryId, localId, "--org", organizationId, "--body", "e2e comment format tsv", "--format", "tsv"],
    {
      cwd: projectRoot,
      env,
      step: "pr.comment.format.tsv",
    }
  ).stdout.trim();
  if (!prCommentFormatTsvOutput.includes("key\tvalue")) {
    fail("pr comment --format tsv verification failed: missing tsv header");
  }
  const prCommentOutPath = path.join(tmpRoot, `pr-comment-${runId}.tsv`);
  runChecked(
    [
      "node",
      cliPath,
      "pr",
      "comment",
      repositoryId,
      localId,
      "--org",
      organizationId,
      "--body",
      "e2e comment out",
      "--format",
      "tsv",
      "--out",
      prCommentOutPath,
    ],
    {
      cwd: projectRoot,
      env,
      step: "pr.comment.out.tsv",
    }
  );
  if (!fs.existsSync(prCommentOutPath)) {
    fail("pr comment --out verification failed: output file not found");
  }
  const prCommentOutText = fs.readFileSync(prCommentOutPath, "utf-8");
  if (!prCommentOutText.includes("key\tvalue")) {
    fail("pr comment --out verification failed: missing tsv header");
  }
  runExpectedFailure(
    ["node", cliPath, "pr", "comment", repositoryId, localId, "--org", organizationId, "--body", "x", "--format", "bad"],
    {
      cwd: projectRoot,
      env,
      step: "pr.comment.format.invalid",
      contains: "Invalid --format value",
    }
  );
  runExpectedFailure(
    [
      "node",
      cliPath,
      "pr",
      "comment",
      repositoryId,
      localId,
      "--org",
      organizationId,
      "--format",
      "table",
      "--out",
      path.join(tmpRoot, `pr-comment-invalid-out-${runId}.txt`),
    ],
    {
      cwd: projectRoot,
      env,
      step: "pr.comment.out.table.invalid",
      contains: "--out` requires --format tsv/json",
    }
  );
  const prReplyResult = runJson(
    [
      "pr",
      "comment-reply",
      repositoryId,
      localId,
      prCommentBizId,
      "--org",
      organizationId,
      "--body",
      "e2e reply comment",
      "--format",
      "json",
    ],
    {
      step: "pr.comment-reply",
    }
  );
  const prReplyCommentBizId = readFirstString(prReplyResult, [
    "comment_biz_id",
    "commentBizId",
    "id",
    "bizId",
  ]);
  if (!prReplyCommentBizId) {
    fail("pr comment-reply verification failed: reply comment biz id not found");
  }
  const prReplyFormatRoot = runJson(
    ["pr", "comment", repositoryId, localId, "--org", organizationId, "--body", "e2e reply format root", "--format", "json"],
    {
      step: "pr.comment-reply.format.root",
    }
  );
  const prReplyFormatRootBizId = readFirstString(prReplyFormatRoot, ["comment_biz_id", "commentBizId", "id", "bizId"]);
  if (!prReplyFormatRootBizId) {
    fail("pr comment-reply format root verification failed: comment biz id not found");
  }
  const prReplyFormatTsvOutput = runChecked(
    [
      "node",
      cliPath,
      "pr",
      "comment-reply",
      repositoryId,
      localId,
      prReplyFormatRootBizId,
      "--org",
      organizationId,
      "--body",
      "e2e reply format tsv",
      "--format",
      "tsv",
    ],
    {
      cwd: projectRoot,
      env,
      step: "pr.comment-reply.format.tsv",
    }
  ).stdout.trim();
  if (!prReplyFormatTsvOutput.includes("key\tvalue")) {
    fail("pr comment-reply --format tsv verification failed: missing tsv header");
  }
  const prReplyFormatTsvBizId = readTsvValue(prReplyFormatTsvOutput, "comment_biz_id");
  const prReplyOutPath = path.join(tmpRoot, `pr-comment-reply-${runId}.tsv`);
  runChecked(
    [
      "node",
      cliPath,
      "pr",
      "comment-reply",
      repositoryId,
      localId,
      prReplyFormatRootBizId,
      "--org",
      organizationId,
      "--body",
      "e2e reply out",
      "--format",
      "tsv",
      "--out",
      prReplyOutPath,
    ],
    {
      cwd: projectRoot,
      env,
      step: "pr.comment-reply.out.tsv",
    }
  );
  if (!fs.existsSync(prReplyOutPath)) {
    fail("pr comment-reply --out verification failed: output file not found");
  }
  const prReplyOutText = fs.readFileSync(prReplyOutPath, "utf-8");
  if (!prReplyOutText.includes("key\tvalue")) {
    fail("pr comment-reply --out verification failed: missing tsv header");
  }
  const prReplyOutBizId = readTsvValue(prReplyOutText, "comment_biz_id");
  runExpectedFailure(
    [
      "node",
      cliPath,
      "pr",
      "comment-reply",
      repositoryId,
      localId,
      prCommentBizId,
      "--org",
      organizationId,
      "--body",
      "x",
      "--format",
      "bad",
    ],
    {
      cwd: projectRoot,
      env,
      step: "pr.comment-reply.format.invalid",
      contains: "Invalid --format value",
    }
  );
  runExpectedFailure(
    [
      "node",
      cliPath,
      "pr",
      "comment-reply",
      repositoryId,
      localId,
      prCommentBizId,
      "--org",
      organizationId,
      "--format",
      "table",
      "--out",
      path.join(tmpRoot, `pr-comment-reply-invalid-out-${runId}.txt`),
    ],
    {
      cwd: projectRoot,
      env,
      step: "pr.comment-reply.out.table.invalid",
      contains: "--out` requires --format tsv/json",
    }
  );
  if (prReplyFormatTsvBizId) {
    runJson(
      ["pr", "comment-delete", repositoryId, localId, prReplyFormatTsvBizId, "--org", organizationId, "--yes", "--json"],
      {
        step: "pr.comment-reply.format.tsv.cleanup",
      }
    );
  }
  if (prReplyOutBizId) {
    runJson(
      ["pr", "comment-delete", repositoryId, localId, prReplyOutBizId, "--org", organizationId, "--yes", "--json"],
      {
        step: "pr.comment-reply.out.cleanup",
      }
    );
  }
  runJson(
    ["pr", "comment-delete", repositoryId, localId, prReplyFormatRootBizId, "--org", organizationId, "--yes", "--json"],
    {
      step: "pr.comment-reply.format.root.cleanup",
    }
  );
  runJson(
    [
      "pr",
      "comment-edit",
      repositoryId,
      localId,
      prCommentBizId,
      "--org",
      organizationId,
      "--body",
      "e2e comment edited",
      "--format",
      "json",
    ],
    {
      step: "pr.comment-edit",
    }
  );
  const prCommentEditTsvOutput = runChecked(
    [
      "node",
      cliPath,
      "pr",
      "comment-edit",
      repositoryId,
      localId,
      prCommentBizId,
      "--org",
      organizationId,
      "--body",
      "e2e comment edited tsv",
      "--format",
      "tsv",
    ],
    {
      cwd: projectRoot,
      env,
      step: "pr.comment-edit.format.tsv",
    }
  ).stdout.trim();
  if (!prCommentEditTsvOutput.includes("key\tvalue")) {
    fail("pr comment-edit --format tsv verification failed: missing tsv header");
  }
  const prCommentEditOutPath = path.join(tmpRoot, `pr-comment-edit-${runId}.tsv`);
  runChecked(
    [
      "node",
      cliPath,
      "pr",
      "comment-edit",
      repositoryId,
      localId,
      prCommentBizId,
      "--org",
      organizationId,
      "--body",
      "e2e comment edited out",
      "--format",
      "tsv",
      "--out",
      prCommentEditOutPath,
    ],
    {
      cwd: projectRoot,
      env,
      step: "pr.comment-edit.out.tsv",
    }
  );
  if (!fs.existsSync(prCommentEditOutPath)) {
    fail("pr comment-edit --out verification failed: output file not found");
  }
  const prCommentEditOutText = fs.readFileSync(prCommentEditOutPath, "utf-8");
  if (!prCommentEditOutText.includes("key\tvalue")) {
    fail("pr comment-edit --out verification failed: missing tsv header");
  }
  runExpectedFailure(
    [
      "node",
      cliPath,
      "pr",
      "comment-edit",
      repositoryId,
      localId,
      prCommentBizId,
      "--org",
      organizationId,
      "--body",
      "x",
      "--format",
      "bad",
    ],
    {
      cwd: projectRoot,
      env,
      step: "pr.comment-edit.format.invalid",
      contains: "Invalid --format value",
    }
  );
  runExpectedFailure(
    [
      "node",
      cliPath,
      "pr",
      "comment-edit",
      repositoryId,
      localId,
      prCommentBizId,
      "--org",
      organizationId,
      "--format",
      "table",
      "--out",
      path.join(tmpRoot, `pr-comment-edit-invalid-out-${runId}.txt`),
    ],
    {
      cwd: projectRoot,
      env,
      step: "pr.comment-edit.out.table.invalid",
      contains: "--out` requires --format tsv/json",
    }
  );
  const prCommentResolveFormatJsonResult = runJson(
    ["pr", "comment-resolve", repositoryId, localId, prCommentBizId, "--org", organizationId, "--format", "json"],
    {
      step: "pr.comment-resolve.format.json",
    }
  );
  if (!isRecord(prCommentResolveFormatJsonResult) || prCommentResolveFormatJsonResult.resolved !== true) {
    fail("pr comment-resolve --format json verification failed: invalid response shape");
  }
  const prCommentResolveFormatTsvOutput = runChecked(
    ["node", cliPath, "pr", "comment-resolve", repositoryId, localId, prCommentBizId, "--org", organizationId, "--format", "tsv"],
    {
      cwd: projectRoot,
      env,
      step: "pr.comment-resolve.format.tsv",
    }
  ).stdout.trim();
  if (!prCommentResolveFormatTsvOutput.includes("key\tvalue")) {
    fail("pr comment-resolve --format tsv verification failed: missing tsv header");
  }
  const prCommentResolveOutPath = path.join(tmpRoot, `pr-comment-resolve-${runId}.tsv`);
  runChecked(
    [
      "node",
      cliPath,
      "pr",
      "comment-resolve",
      repositoryId,
      localId,
      prCommentBizId,
      "--org",
      organizationId,
      "--format",
      "tsv",
      "--out",
      prCommentResolveOutPath,
    ],
    {
      cwd: projectRoot,
      env,
      step: "pr.comment-resolve.out.tsv",
    }
  );
  if (!fs.existsSync(prCommentResolveOutPath)) {
    fail("pr comment-resolve --out verification failed: output file not found");
  }
  const prCommentResolveOutText = fs.readFileSync(prCommentResolveOutPath, "utf-8");
  if (!prCommentResolveOutText.includes("key\tvalue")) {
    fail("pr comment-resolve --out verification failed: missing tsv header");
  }
  runExpectedFailure(
    ["node", cliPath, "pr", "comment-resolve", repositoryId, localId, prCommentBizId, "--org", organizationId, "--format", "bad"],
    {
      cwd: projectRoot,
      env,
      step: "pr.comment-resolve.format.invalid",
      contains: "Invalid --format value",
    }
  );
  runExpectedFailure(
    [
      "node",
      cliPath,
      "pr",
      "comment-resolve",
      repositoryId,
      localId,
      prCommentBizId,
      "--org",
      organizationId,
      "--format",
      "table",
      "--out",
      path.join(tmpRoot, `pr-comment-resolve-invalid-out-${runId}.txt`),
    ],
    {
      cwd: projectRoot,
      env,
      step: "pr.comment-resolve.out.table.invalid",
      contains: "--out` requires --format tsv/json",
    }
  );
  runJson(["pr", "comment-resolve", repositoryId, localId, prCommentBizId, "--org", organizationId, "--json"], {
    step: "pr.comment-resolve",
  });
  const resolvedPrComments = runJson(
    ["pr", "comments", repositoryId, localId, "--org", organizationId, "--state", "all", "--resolved", "--json"],
    {
      step: "pr.comments.resolved",
    }
  );
  const resolvedCommentItems = extractRecordArray(resolvedPrComments);
  if (!resolvedCommentItems.some((item) => readFirstString(item, ["comment_biz_id", "commentBizId", "id"]) === prCommentBizId)) {
    fail("pr comment-resolve verification failed: resolved comment not found");
  }
  const prCommentUnresolveFormatJsonResult = runJson(
    ["pr", "comment-unresolve", repositoryId, localId, prCommentBizId, "--org", organizationId, "--format", "json"],
    {
      step: "pr.comment-unresolve.format.json",
    }
  );
  if (!isRecord(prCommentUnresolveFormatJsonResult) || prCommentUnresolveFormatJsonResult.resolved !== false) {
    fail("pr comment-unresolve --format json verification failed: invalid response shape");
  }
  const prCommentUnresolveFormatTsvOutput = runChecked(
    ["node", cliPath, "pr", "comment-unresolve", repositoryId, localId, prCommentBizId, "--org", organizationId, "--format", "tsv"],
    {
      cwd: projectRoot,
      env,
      step: "pr.comment-unresolve.format.tsv",
    }
  ).stdout.trim();
  if (!prCommentUnresolveFormatTsvOutput.includes("key\tvalue")) {
    fail("pr comment-unresolve --format tsv verification failed: missing tsv header");
  }
  const prCommentUnresolveOutPath = path.join(tmpRoot, `pr-comment-unresolve-${runId}.tsv`);
  runChecked(
    [
      "node",
      cliPath,
      "pr",
      "comment-unresolve",
      repositoryId,
      localId,
      prCommentBizId,
      "--org",
      organizationId,
      "--format",
      "tsv",
      "--out",
      prCommentUnresolveOutPath,
    ],
    {
      cwd: projectRoot,
      env,
      step: "pr.comment-unresolve.out.tsv",
    }
  );
  if (!fs.existsSync(prCommentUnresolveOutPath)) {
    fail("pr comment-unresolve --out verification failed: output file not found");
  }
  const prCommentUnresolveOutText = fs.readFileSync(prCommentUnresolveOutPath, "utf-8");
  if (!prCommentUnresolveOutText.includes("key\tvalue")) {
    fail("pr comment-unresolve --out verification failed: missing tsv header");
  }
  runExpectedFailure(
    ["node", cliPath, "pr", "comment-unresolve", repositoryId, localId, prCommentBizId, "--org", organizationId, "--format", "bad"],
    {
      cwd: projectRoot,
      env,
      step: "pr.comment-unresolve.format.invalid",
      contains: "Invalid --format value",
    }
  );
  runExpectedFailure(
    [
      "node",
      cliPath,
      "pr",
      "comment-unresolve",
      repositoryId,
      localId,
      prCommentBizId,
      "--org",
      organizationId,
      "--format",
      "table",
      "--out",
      path.join(tmpRoot, `pr-comment-unresolve-invalid-out-${runId}.txt`),
    ],
    {
      cwd: projectRoot,
      env,
      step: "pr.comment-unresolve.out.table.invalid",
      contains: "--out` requires --format tsv/json",
    }
  );
  runJson(["pr", "comment-unresolve", repositoryId, localId, prCommentBizId, "--org", organizationId, "--json"], {
    step: "pr.comment-unresolve",
  });
  const prComments = runJson(["pr", "comments", repositoryId, localId, "--org", organizationId, "--json"], {
    step: "pr.comments",
  });
  if (!Array.isArray(prComments) || prComments.length === 0) {
    fail("pr comments verification failed: expected non-empty list");
  }
  const prCommentsFormatJson = runJson(
    ["pr", "comments", repositoryId, localId, "--org", organizationId, "--format", "json"],
    {
      step: "pr.comments.format.json",
    }
  );
  if (!Array.isArray(prCommentsFormatJson) || prCommentsFormatJson.length === 0) {
    fail("pr comments --format json verification failed: invalid response shape");
  }
  const prCommentsFormatTsvOutput = runChecked(
    ["node", cliPath, "pr", "comments", repositoryId, localId, "--org", organizationId, "--format", "tsv"],
    {
      cwd: projectRoot,
      env,
      step: "pr.comments.format.tsv",
    }
  ).stdout.trim();
  if (!prCommentsFormatTsvOutput.includes("commentBizId\tparentCommentBizId\tcommentType")) {
    fail("pr comments --format tsv verification failed: missing tsv header");
  }
  const prCommentsOutPath = path.join(tmpRoot, `pr-comments-${runId}.tsv`);
  runChecked(
    [
      "node",
      cliPath,
      "pr",
      "comments",
      repositoryId,
      localId,
      "--org",
      organizationId,
      "--format",
      "tsv",
      "--out",
      prCommentsOutPath,
    ],
    {
      cwd: projectRoot,
      env,
      step: "pr.comments.out.tsv",
    }
  );
  if (!fs.existsSync(prCommentsOutPath)) {
    fail("pr comments --out verification failed: output file not found");
  }
  const prCommentsOutText = fs.readFileSync(prCommentsOutPath, "utf-8");
  if (!prCommentsOutText.includes("commentBizId\tparentCommentBizId\tcommentType")) {
    fail("pr comments --out verification failed: missing tsv header");
  }
  runExpectedFailure(
    ["node", cliPath, "pr", "comments", repositoryId, localId, "--org", organizationId, "--format", "bad"],
    {
      cwd: projectRoot,
      env,
      step: "pr.comments.format.invalid",
      contains: "Invalid --format value",
    }
  );
  runExpectedFailure(
    [
      "node",
      cliPath,
      "pr",
      "comments",
      repositoryId,
      localId,
      "--org",
      organizationId,
      "--format",
      "table",
      "--out",
      path.join(tmpRoot, `pr-comments-invalid-out-${runId}.txt`),
    ],
    {
      cwd: projectRoot,
      env,
      step: "pr.comments.out.table.invalid",
      contains: "--out` requires --format tsv/json",
    }
  );
  const prCommentsSummary = runJson(
    ["pr", "comments", repositoryId, localId, "--org", organizationId, "--summary", "--json"],
    {
      step: "pr.comments.summary",
    }
  );
  if (
    !isRecord(prCommentsSummary) ||
    typeof prCommentsSummary.total !== "number" ||
    !isRecord(prCommentsSummary.byType)
  ) {
    fail("pr comments --summary verification failed: invalid response shape");
  }
  const prCommentsSummaryTsvOutput = runChecked(
    [
      "node",
      cliPath,
      "pr",
      "comments",
      repositoryId,
      localId,
      "--org",
      organizationId,
      "--summary",
      "--format",
      "tsv",
    ],
    {
      cwd: projectRoot,
      env,
      step: "pr.comments.summary.format.tsv",
    }
  ).stdout.trim();
  if (!prCommentsSummaryTsvOutput.includes("section\tkey\tvalue\tpath")) {
    fail("pr comments --summary --format tsv verification failed: missing tsv header");
  }
  const prThreads = runJson(["pr", "threads", repositoryId, localId, "--org", organizationId, "--json"], {
    step: "pr.threads",
  });
  if (!Array.isArray(prThreads) || prThreads.length === 0) {
    fail("pr threads verification failed: invalid response shape");
  }
  const prThreadsAll = runJson(
    ["pr", "threads", repositoryId, localId, "--org", organizationId, "--all", "--json"],
    {
      step: "pr.threads.all",
    }
  );
  if (!Array.isArray(prThreadsAll) || prThreadsAll.length < prThreads.length) {
    fail("pr threads --all verification failed: invalid response shape");
  }
  const prThreadsSummary = runJson(
    ["pr", "threads", repositoryId, localId, "--org", organizationId, "--all", "--summary", "--json"],
    {
      step: "pr.threads.summary",
    }
  );
  if (
    !isRecord(prThreadsSummary) ||
    typeof prThreadsSummary.totalThreads !== "number" ||
    typeof prThreadsSummary.openThreads !== "number" ||
    typeof prThreadsSummary.resolvedThreads !== "number"
  ) {
    fail("pr threads --summary verification failed: invalid response shape");
  }
  const prThreadsByAuthor = runJson(
    ["pr", "threads", repositoryId, localId, "--org", organizationId, "--all", "--author", currentUserId, "--json"],
    {
      step: "pr.threads.author",
    }
  );
  if (!Array.isArray(prThreadsByAuthor) || prThreadsByAuthor.length === 0) {
    fail("pr threads --author verification failed: invalid response shape");
  }
  const prThreadsMine = runJson(
    ["pr", "threads", repositoryId, localId, "--org", organizationId, "--all", "--mine", "--json"],
    {
      step: "pr.threads.mine",
    }
  );
  if (!Array.isArray(prThreadsMine) || prThreadsMine.length === 0) {
    fail("pr threads --mine verification failed: invalid response shape");
  }
  const prThreadsLimit = runJson(
    ["pr", "threads", repositoryId, localId, "--org", organizationId, "--all", "--limit", "1", "--json"],
    {
      step: "pr.threads.limit",
    }
  );
  if (!Array.isArray(prThreadsLimit) || prThreadsLimit.length === 0 || prThreadsLimit.length > 1) {
    fail("pr threads --limit verification failed: invalid response shape");
  }
  const prThreadsIdsOnly = runJson(
    ["pr", "threads", repositoryId, localId, "--org", organizationId, "--all", "--limit", "1", "--ids-only", "--json"],
    {
      step: "pr.threads.ids-only",
    }
  );
  if (
    !Array.isArray(prThreadsIdsOnly) ||
    prThreadsIdsOnly.length === 0 ||
    !isRecord(prThreadsIdsOnly[0]) ||
    typeof prThreadsIdsOnly[0].threadId !== "string" ||
    typeof prThreadsIdsOnly[0].rootCommentBizId !== "string" ||
    !Array.isArray(prThreadsIdsOnly[0].commentBizIds)
  ) {
    fail("pr threads --ids-only verification failed: invalid response shape");
  }
  const prThreadsTsvOutput = runChecked(
    ["node", cliPath, "pr", "threads", repositoryId, localId, "--org", organizationId, "--all", "--ids-only", "--limit", "1", "--format", "tsv"],
    {
      cwd: projectRoot,
      env,
      step: "pr.threads.format.tsv",
    }
  ).stdout.trim();
  if (!prThreadsTsvOutput.includes("threadId\trootCommentBizId")) {
    fail("pr threads --format tsv verification failed: missing tsv header");
  }
  const prThreadsFormatJson = runJson(
    ["pr", "threads", repositoryId, localId, "--org", organizationId, "--all", "--ids-only", "--limit", "1", "--format", "json", "--json"],
    {
      step: "pr.threads.format.json",
    }
  );
  if (
    !Array.isArray(prThreadsFormatJson) ||
    prThreadsFormatJson.length === 0 ||
    !isRecord(prThreadsFormatJson[0]) ||
    typeof prThreadsFormatJson[0].threadId !== "string"
  ) {
    fail("pr threads --format json verification failed: invalid response shape");
  }
  const prThreadsOutPath = path.join(tmpRoot, `pr-threads-${runId}.tsv`);
  runChecked(
    [
      "node",
      cliPath,
      "pr",
      "threads",
      repositoryId,
      localId,
      "--org",
      organizationId,
      "--all",
      "--ids-only",
      "--limit",
      "1",
      "--format",
      "tsv",
      "--out",
      prThreadsOutPath,
    ],
    {
      cwd: projectRoot,
      env,
      step: "pr.threads.out.tsv",
    }
  );
  if (!fs.existsSync(prThreadsOutPath)) {
    fail("pr threads --out verification failed: output file not found");
  }
  const prThreadsOutText = fs.readFileSync(prThreadsOutPath, "utf-8");
  if (!prThreadsOutText.includes("threadId\trootCommentBizId")) {
    fail("pr threads --out verification failed: missing tsv header");
  }
  runExpectedFailure(
    ["node", cliPath, "pr", "threads", repositoryId, localId, "--org", organizationId, "--format", "bad"],
    {
      cwd: projectRoot,
      env,
      step: "pr.threads.format.invalid",
      contains: "Invalid --format value",
    }
  );
  runExpectedFailure(
    [
      "node",
      cliPath,
      "pr",
      "threads",
      repositoryId,
      localId,
      "--org",
      organizationId,
      "--all",
      "--ids-only",
      "--limit",
      "1",
      "--format",
      "table",
      "--out",
      path.join(tmpRoot, `pr-threads-invalid-out-${runId}.txt`),
    ],
    {
      cwd: projectRoot,
      env,
      step: "pr.threads.out.table.invalid",
      contains: "--out` requires --format tsv/json",
    }
  );
  const prThreadsWithReplies = runJson(
    ["pr", "threads", repositoryId, localId, "--org", organizationId, "--all", "--with-replies", "--json"],
    {
      step: "pr.threads.with-replies",
    }
  );
  if (
    !Array.isArray(prThreadsWithReplies) ||
    prThreadsWithReplies.length === 0 ||
    !prThreadsWithReplies.every((item) => isRecord(item) && Number(item.totalComments ?? 0) > 1)
  ) {
    fail("pr threads --with-replies verification failed: invalid response shape");
  }
  const prThreadsSince = runJson(
    ["pr", "threads", repositoryId, localId, "--org", organizationId, "--all", "--since", "1970-01-01T00:00:00Z", "--json"],
    {
      step: "pr.threads.since",
    }
  );
  if (!Array.isArray(prThreadsSince) || prThreadsSince.length === 0) {
    fail("pr threads --since verification failed: invalid response shape");
  }
  const prThreadsSinceFuture = runJson(
    [
      "pr",
      "threads",
      repositoryId,
      localId,
      "--org",
      organizationId,
      "--all",
      "--since",
      "2999-01-01T00:00:00Z",
      "--json",
    ],
    {
      step: "pr.threads.since.future",
    }
  );
  if (!Array.isArray(prThreadsSinceFuture) || prThreadsSinceFuture.length !== 0) {
    fail("pr threads --since future verification failed: expected empty result");
  }
  const prThreadsContains = runJson(
    ["pr", "threads", repositoryId, localId, "--org", organizationId, "--all", "--contains", "e2e comment edited", "--json"],
    {
      step: "pr.threads.contains",
    }
  );
  if (!Array.isArray(prThreadsContains) || prThreadsContains.length === 0) {
    fail("pr threads --contains verification failed: invalid response shape");
  }
  const prThreadsContainsMiss = runJson(
    [
      "pr",
      "threads",
      repositoryId,
      localId,
      "--org",
      organizationId,
      "--all",
      "--contains",
      "no-such-thread-content-keyword",
      "--json",
    ],
    {
      step: "pr.threads.contains.miss",
    }
  );
  if (!Array.isArray(prThreadsContainsMiss) || prThreadsContainsMiss.length !== 0) {
    fail("pr threads --contains miss verification failed: expected empty result");
  }
  const prThreadsSortOldest = runJson(
    ["pr", "threads", repositoryId, localId, "--org", organizationId, "--all", "--sort", "oldest", "--json"],
    {
      step: "pr.threads.sort.oldest",
    }
  );
  if (!Array.isArray(prThreadsSortOldest) || prThreadsSortOldest.length === 0) {
    fail("pr threads --sort oldest verification failed: invalid response shape");
  }
  if (prThreadsSortOldest.length >= 2) {
    const first = Date.parse(String(prThreadsSortOldest[0]?.lastCommentAt ?? ""));
    const second = Date.parse(String(prThreadsSortOldest[1]?.lastCommentAt ?? ""));
    if (Number.isFinite(first) && Number.isFinite(second) && first > second) {
      fail("pr threads --sort oldest verification failed: unexpected order");
    }
  }
  runJson(
    [
      "pr",
      "comment",
      repositoryId,
      localId,
      "--org",
      organizationId,
      "--inline",
      "--file",
      "feature.txt",
      "--line",
      "1",
      "--body",
      "e2e inline comment",
      "--json",
    ],
    {
      step: "pr.comment.inline",
    }
  );
  runJson(
    ["pr", "comments", repositoryId, localId, "--org", organizationId, "--type", "inline", "--file", "feature.txt", "--json"],
    {
      step: "pr.comments.inline",
    }
  );
  const inlineThreads = runJson(
    ["pr", "threads", repositoryId, localId, "--org", organizationId, "--file", "feature.txt", "--all", "--json"],
    {
      step: "pr.threads.file",
    }
  );
  if (!Array.isArray(inlineThreads) || inlineThreads.length === 0) {
    fail("pr threads --file verification failed: expected at least one file thread");
  }
  const prCommentDeleteFormatJsonSeed = runJson(
    ["pr", "comment", repositoryId, localId, "--org", organizationId, "--body", "e2e delete format json seed", "--format", "json"],
    {
      step: "pr.comment-delete.format.seed.json",
    }
  );
  const prCommentDeleteFormatJsonBizId = readFirstString(prCommentDeleteFormatJsonSeed, [
    "comment_biz_id",
    "commentBizId",
    "id",
    "bizId",
  ]);
  if (!prCommentDeleteFormatJsonBizId) {
    fail("pr comment-delete --format json setup failed: comment biz id not found");
  }
  const prCommentDeleteFormatJsonResult = runJson(
    [
      "pr",
      "comment-delete",
      repositoryId,
      localId,
      prCommentDeleteFormatJsonBizId,
      "--org",
      organizationId,
      "--yes",
      "--format",
      "json",
    ],
    {
      step: "pr.comment-delete.format.json",
    }
  );
  if (!isRecord(prCommentDeleteFormatJsonResult)) {
    fail("pr comment-delete --format json verification failed: invalid response shape");
  }
  const prCommentDeleteFormatTsvSeed = runJson(
    ["pr", "comment", repositoryId, localId, "--org", organizationId, "--body", "e2e delete format tsv seed", "--format", "json"],
    {
      step: "pr.comment-delete.format.seed.tsv",
    }
  );
  const prCommentDeleteFormatTsvBizId = readFirstString(prCommentDeleteFormatTsvSeed, [
    "comment_biz_id",
    "commentBizId",
    "id",
    "bizId",
  ]);
  if (!prCommentDeleteFormatTsvBizId) {
    fail("pr comment-delete --format tsv setup failed: comment biz id not found");
  }
  const prCommentDeleteFormatTsvOutput = runChecked(
    [
      "node",
      cliPath,
      "pr",
      "comment-delete",
      repositoryId,
      localId,
      prCommentDeleteFormatTsvBizId,
      "--org",
      organizationId,
      "--yes",
      "--format",
      "tsv",
    ],
    {
      cwd: projectRoot,
      env,
      step: "pr.comment-delete.format.tsv",
    }
  ).stdout.trim();
  if (!prCommentDeleteFormatTsvOutput.includes("key\tvalue")) {
    fail("pr comment-delete --format tsv verification failed: missing tsv header");
  }
  const prCommentDeleteOutSeed = runJson(
    ["pr", "comment", repositoryId, localId, "--org", organizationId, "--body", "e2e delete out seed", "--format", "json"],
    {
      step: "pr.comment-delete.out.seed",
    }
  );
  const prCommentDeleteOutBizId = readFirstString(prCommentDeleteOutSeed, [
    "comment_biz_id",
    "commentBizId",
    "id",
    "bizId",
  ]);
  if (!prCommentDeleteOutBizId) {
    fail("pr comment-delete --out setup failed: comment biz id not found");
  }
  const prCommentDeleteOutPath = path.join(tmpRoot, `pr-comment-delete-${runId}.tsv`);
  runChecked(
    [
      "node",
      cliPath,
      "pr",
      "comment-delete",
      repositoryId,
      localId,
      prCommentDeleteOutBizId,
      "--org",
      organizationId,
      "--yes",
      "--format",
      "tsv",
      "--out",
      prCommentDeleteOutPath,
    ],
    {
      cwd: projectRoot,
      env,
      step: "pr.comment-delete.out.tsv",
    }
  );
  if (!fs.existsSync(prCommentDeleteOutPath)) {
    fail("pr comment-delete --out verification failed: output file not found");
  }
  const prCommentDeleteOutText = fs.readFileSync(prCommentDeleteOutPath, "utf-8");
  if (!prCommentDeleteOutText.includes("key\tvalue")) {
    fail("pr comment-delete --out verification failed: missing tsv header");
  }
  runExpectedFailure(
    [
      "node",
      cliPath,
      "pr",
      "comment-delete",
      repositoryId,
      localId,
      prReplyCommentBizId,
      "--org",
      organizationId,
      "--yes",
      "--format",
      "bad",
    ],
    {
      cwd: projectRoot,
      env,
      step: "pr.comment-delete.format.invalid",
      contains: "Invalid --format value",
    }
  );
  runExpectedFailure(
    [
      "node",
      cliPath,
      "pr",
      "comment-delete",
      repositoryId,
      localId,
      prReplyCommentBizId,
      "--org",
      organizationId,
      "--yes",
      "--format",
      "table",
      "--out",
      path.join(tmpRoot, `pr-comment-delete-invalid-out-${runId}.txt`),
    ],
    {
      cwd: projectRoot,
      env,
      step: "pr.comment-delete.out.table.invalid",
      contains: "--out` requires --format tsv/json",
    }
  );
  runJson(
    ["pr", "comment-delete", repositoryId, localId, prReplyCommentBizId, "--org", organizationId, "--yes", "--json"],
    {
      step: "pr.comment-delete.reply",
    }
  );
  runJson(
    ["pr", "comment-delete", repositoryId, localId, prCommentBizId, "--org", organizationId, "--yes", "--json"],
    {
      step: "pr.comment-delete",
    }
  );
  const reviewsResult = runJson(["pr", "reviews", repositoryId, localId, "--org", organizationId, "--json"], {
    step: "pr.reviews",
  });
  if (!isRecord(reviewsResult) || !Array.isArray(reviewsResult.reviewers) || !isRecord(reviewsResult.summary)) {
    fail("pr reviews verification failed: invalid response shape");
  }
  const reviewsFormatJsonResult = runJson(
    ["pr", "reviews", repositoryId, localId, "--org", organizationId, "--format", "json"],
    {
      step: "pr.reviews.format.json",
    }
  );
  if (!isRecord(reviewsFormatJsonResult) || !Array.isArray(reviewsFormatJsonResult.reviewers)) {
    fail("pr reviews --format json verification failed: invalid response shape");
  }
  const reviewsFormatTsvOutput = runChecked(
    ["node", cliPath, "pr", "reviews", repositoryId, localId, "--org", organizationId, "--format", "tsv"],
    {
      cwd: projectRoot,
      env,
      step: "pr.reviews.format.tsv",
    }
  ).stdout.trim();
  if (!reviewsFormatTsvOutput.includes("section\tname\tstate")) {
    fail("pr reviews --format tsv verification failed: missing tsv header");
  }
  const reviewsOutPath = path.join(tmpRoot, `pr-reviews-${runId}.tsv`);
  runChecked(
    [
      "node",
      cliPath,
      "pr",
      "reviews",
      repositoryId,
      localId,
      "--org",
      organizationId,
      "--format",
      "tsv",
      "--out",
      reviewsOutPath,
    ],
    {
      cwd: projectRoot,
      env,
      step: "pr.reviews.out.tsv",
    }
  );
  if (!fs.existsSync(reviewsOutPath)) {
    fail("pr reviews --out verification failed: output file not found");
  }
  const reviewsOutText = fs.readFileSync(reviewsOutPath, "utf-8");
  if (!reviewsOutText.includes("section\tname\tstate")) {
    fail("pr reviews --out verification failed: missing tsv header");
  }
  runExpectedFailure(
    ["node", cliPath, "pr", "reviews", repositoryId, localId, "--org", organizationId, "--format", "bad"],
    {
      cwd: projectRoot,
      env,
      step: "pr.reviews.format.invalid",
      contains: "Invalid --format value",
    }
  );
  runExpectedFailure(
    [
      "node",
      cliPath,
      "pr",
      "reviews",
      repositoryId,
      localId,
      "--org",
      organizationId,
      "--format",
      "table",
      "--out",
      path.join(tmpRoot, `pr-reviews-invalid-out-${runId}.txt`),
    ],
    {
      cwd: projectRoot,
      env,
      step: "pr.reviews.out.table.invalid",
      contains: "--out` requires --format tsv/json",
    }
  );
  const checksResult = runJson(["pr", "checks", repositoryId, localId, "--org", organizationId, "--json"], {
    step: "pr.checks",
  });
  if (!isRecord(checksResult) || !Array.isArray(checksResult.checks)) {
    fail("pr checks verification failed: invalid response shape");
  }
  const checksFormatJsonResult = runJson(
    ["pr", "checks", repositoryId, localId, "--org", organizationId, "--format", "json"],
    {
      step: "pr.checks.format.json",
    }
  );
  if (!isRecord(checksFormatJsonResult) || !Array.isArray(checksFormatJsonResult.checks)) {
    fail("pr checks --format json verification failed: invalid response shape");
  }
  const checksFormatTsvOutput = runChecked(
    ["node", cliPath, "pr", "checks", repositoryId, localId, "--org", organizationId, "--format", "tsv"],
    {
      cwd: projectRoot,
      env,
      step: "pr.checks.format.tsv",
    }
  ).stdout.trim();
  if (!checksFormatTsvOutput.includes("section\tname\tstatus")) {
    fail("pr checks --format tsv verification failed: missing tsv header");
  }
  const checksOutPath = path.join(tmpRoot, `pr-checks-${runId}.tsv`);
  runChecked(
    [
      "node",
      cliPath,
      "pr",
      "checks",
      repositoryId,
      localId,
      "--org",
      organizationId,
      "--format",
      "tsv",
      "--out",
      checksOutPath,
    ],
    {
      cwd: projectRoot,
      env,
      step: "pr.checks.out.tsv",
    }
  );
  if (!fs.existsSync(checksOutPath)) {
    fail("pr checks --out verification failed: output file not found");
  }
  const checksOutText = fs.readFileSync(checksOutPath, "utf-8");
  if (!checksOutText.includes("section\tname\tstatus")) {
    fail("pr checks --out verification failed: missing tsv header");
  }
  runExpectedFailure(
    ["node", cliPath, "pr", "checks", repositoryId, localId, "--org", organizationId, "--format", "bad"],
    {
      cwd: projectRoot,
      env,
      step: "pr.checks.format.invalid",
      contains: "Invalid --format value",
    }
  );
  runExpectedFailure(
    [
      "node",
      cliPath,
      "pr",
      "checks",
      repositoryId,
      localId,
      "--org",
      organizationId,
      "--format",
      "table",
      "--out",
      path.join(tmpRoot, `pr-checks-invalid-out-${runId}.txt`),
    ],
    {
      cwd: projectRoot,
      env,
      step: "pr.checks.out.table.invalid",
      contains: "--out` requires --format tsv/json",
    }
  );
  const patchsetsResult = runJson(["pr", "patchsets", repositoryId, localId, "--org", organizationId, "--json"], {
    step: "pr.patchsets",
  });
  if (!isRecord(patchsetsResult) || !Array.isArray(patchsetsResult.patchsets)) {
    fail("pr patchsets verification failed: invalid response shape");
  }
  const patchsetsFormatJsonResult = runJson(
    ["pr", "patchsets", repositoryId, localId, "--org", organizationId, "--format", "json"],
    {
      step: "pr.patchsets.format.json",
    }
  );
  if (!isRecord(patchsetsFormatJsonResult) || !Array.isArray(patchsetsFormatJsonResult.patchsets)) {
    fail("pr patchsets --format json verification failed: invalid response shape");
  }
  const patchsetsFormatTsvOutput = runChecked(
    ["node", cliPath, "pr", "patchsets", repositoryId, localId, "--org", organizationId, "--format", "tsv"],
    {
      cwd: projectRoot,
      env,
      step: "pr.patchsets.format.tsv",
    }
  ).stdout.trim();
  if (!patchsetsFormatTsvOutput.includes("id\tversion\ttype")) {
    fail("pr patchsets --format tsv verification failed: missing tsv header");
  }
  const patchsetsOutPath = path.join(tmpRoot, `pr-patchsets-${runId}.tsv`);
  runChecked(
    [
      "node",
      cliPath,
      "pr",
      "patchsets",
      repositoryId,
      localId,
      "--org",
      organizationId,
      "--format",
      "tsv",
      "--out",
      patchsetsOutPath,
    ],
    {
      cwd: projectRoot,
      env,
      step: "pr.patchsets.out.tsv",
    }
  );
  if (!fs.existsSync(patchsetsOutPath)) {
    fail("pr patchsets --out verification failed: output file not found");
  }
  const patchsetsOutText = fs.readFileSync(patchsetsOutPath, "utf-8");
  if (!patchsetsOutText.includes("id\tversion\ttype")) {
    fail("pr patchsets --out verification failed: missing tsv header");
  }
  runExpectedFailure(
    ["node", cliPath, "pr", "patchsets", repositoryId, localId, "--org", organizationId, "--format", "bad"],
    {
      cwd: projectRoot,
      env,
      step: "pr.patchsets.format.invalid",
      contains: "Invalid --format value",
    }
  );
  runExpectedFailure(
    [
      "node",
      cliPath,
      "pr",
      "patchsets",
      repositoryId,
      localId,
      "--org",
      organizationId,
      "--format",
      "table",
      "--out",
      path.join(tmpRoot, `pr-patchsets-invalid-out-${runId}.txt`),
    ],
    {
      cwd: projectRoot,
      env,
      step: "pr.patchsets.out.table.invalid",
      contains: "--out` requires --format tsv/json",
    }
  );
  const filesResult = runJson(["pr", "files", repositoryId, localId, "--org", organizationId, "--json"], {
    step: "pr.files",
  });
  if (!isRecord(filesResult) || !Array.isArray(filesResult.files)) {
    fail("pr files verification failed: invalid response shape");
  }
  const filesFormatJsonResult = runJson(
    ["pr", "files", repositoryId, localId, "--org", organizationId, "--format", "json"],
    {
      step: "pr.files.format.json",
    }
  );
  if (!isRecord(filesFormatJsonResult) || !Array.isArray(filesFormatJsonResult.files)) {
    fail("pr files --format json verification failed: invalid response shape");
  }
  const filesFormatTsvOutput = runChecked(
    ["node", cliPath, "pr", "files", repositoryId, localId, "--org", organizationId, "--format", "tsv"],
    {
      cwd: projectRoot,
      env,
      step: "pr.files.format.tsv",
    }
  ).stdout.trim();
  if (!filesFormatTsvOutput.includes("path")) {
    fail("pr files --format tsv verification failed: missing tsv header");
  }
  const filesOutPath = path.join(tmpRoot, `pr-files-${runId}.tsv`);
  runChecked(
    [
      "node",
      cliPath,
      "pr",
      "files",
      repositoryId,
      localId,
      "--org",
      organizationId,
      "--format",
      "tsv",
      "--out",
      filesOutPath,
    ],
    {
      cwd: projectRoot,
      env,
      step: "pr.files.out.tsv",
    }
  );
  if (!fs.existsSync(filesOutPath)) {
    fail("pr files --out verification failed: output file not found");
  }
  const filesOutText = fs.readFileSync(filesOutPath, "utf-8");
  if (!filesOutText.includes("path")) {
    fail("pr files --out verification failed: missing tsv header");
  }
  runExpectedFailure(
    ["node", cliPath, "pr", "files", repositoryId, localId, "--org", organizationId, "--format", "bad"],
    {
      cwd: projectRoot,
      env,
      step: "pr.files.format.invalid",
      contains: "Invalid --format value",
    }
  );
  runExpectedFailure(
    [
      "node",
      cliPath,
      "pr",
      "files",
      repositoryId,
      localId,
      "--org",
      organizationId,
      "--format",
      "table",
      "--out",
      path.join(tmpRoot, `pr-files-invalid-out-${runId}.txt`),
    ],
    {
      cwd: projectRoot,
      env,
      step: "pr.files.out.table.invalid",
      contains: "--out` requires --format tsv/json",
    }
  );
  const filesTreeOutput = runChecked(
    ["node", cliPath, "pr", "files", repositoryId, localId, "--org", organizationId, "--tree"],
    {
      cwd: projectRoot,
      env,
      step: "pr.files.tree",
    }
  ).stdout.trim();
  if (!filesTreeOutput) {
    fail("pr files --tree verification failed: empty output");
  }
  const prEditResult = runJson(
    [
      "pr",
      "edit",
      repositoryId,
      localId,
      "--org",
      organizationId,
      "--title",
      "e2e smoke pr (edited)",
      "--description",
      "edited by smoke test",
      "--json",
    ],
    {
      step: "pr.edit",
    }
  );
  if (!isRecord(prEditResult) || !isRecord(prEditResult.pullRequest)) {
    fail("pr edit verification failed: invalid response shape");
  }
  const prEditFormatJson = runJson(
    [
      "pr",
      "edit",
      repositoryId,
      localId,
      "--org",
      organizationId,
      "--description",
      `edited by smoke test format json ${runId}`,
      "--format",
      "json",
    ],
    {
      step: "pr.edit.format.json",
    }
  );
  if (!isRecord(prEditFormatJson) || !isRecord(prEditFormatJson.pullRequest)) {
    fail("pr edit --format json verification failed: invalid response shape");
  }
  const prEditFormatTsvOutput = runChecked(
    [
      "node",
      cliPath,
      "pr",
      "edit",
      repositoryId,
      localId,
      "--org",
      organizationId,
      "--description",
      `edited by smoke test format tsv ${runId}`,
      "--format",
      "tsv",
    ],
    {
      cwd: projectRoot,
      env,
      step: "pr.edit.format.tsv",
    }
  ).stdout.trim();
  if (!prEditFormatTsvOutput.includes("key\tvalue")) {
    fail("pr edit --format tsv verification failed: missing tsv header");
  }
  const prEditOutPath = path.join(tmpRoot, `pr-edit-${runId}.tsv`);
  runChecked(
    [
      "node",
      cliPath,
      "pr",
      "edit",
      repositoryId,
      localId,
      "--org",
      organizationId,
      "--description",
      `edited by smoke test out ${runId}`,
      "--format",
      "tsv",
      "--out",
      prEditOutPath,
    ],
    {
      cwd: projectRoot,
      env,
      step: "pr.edit.out.tsv",
    }
  );
  if (!fs.existsSync(prEditOutPath)) {
    fail("pr edit --out verification failed: output file not found");
  }
  const prEditOutText = fs.readFileSync(prEditOutPath, "utf-8");
  if (!prEditOutText.includes("key\tvalue")) {
    fail("pr edit --out verification failed: missing tsv header");
  }
  runExpectedFailure(
    [
      "node",
      cliPath,
      "pr",
      "edit",
      repositoryId,
      localId,
      "--org",
      organizationId,
      "--description",
      `edited by smoke test invalid format ${runId}`,
      "--format",
      "bad",
    ],
    {
      cwd: projectRoot,
      env,
      step: "pr.edit.format.invalid",
      contains: "Invalid --format value",
    }
  );
  runExpectedFailure(
    [
      "node",
      cliPath,
      "pr",
      "edit",
      repositoryId,
      localId,
      "--org",
      organizationId,
      "--description",
      `edited by smoke test invalid out ${runId}`,
      "--format",
      "table",
      "--out",
      path.join(tmpRoot, `pr-edit-invalid-out-${runId}.txt`),
    ],
    {
      cwd: projectRoot,
      env,
      step: "pr.edit.out.table.invalid",
      contains: "--out` requires --format tsv/json",
    }
  );

  const diffResult = runJson(["pr", "diff", repositoryId, localId, "--org", organizationId, "--json"], {
    step: "pr.diff",
  });
  if (isRecord(diffResult) && typeof diffResult.warning === "string") {
    warnings.push(`pr.diff warning: ${diffResult.warning}`);
  }
  const diffPatchArgs = ["pr", "diff", repositoryId, localId, "--org", organizationId, "--patch", "--json"];
  if (isRecord(diffResult) && Array.isArray(diffResult.files) && diffResult.files.length > 0) {
    const firstPath = readFirstString(diffResult.files[0], ["path"]);
    if (firstPath) {
      diffPatchArgs.push("--file", firstPath);
    }
  }
  const diffPatchResult = runJson(diffPatchArgs, {
    step: "pr.diff.patch",
  });
  if (!isRecord(diffPatchResult) || !Array.isArray(diffPatchResult.patches)) {
    fail("pr diff --patch verification failed: invalid response shape");
  }
  const diffPatchSavePath = path.join(tmpRoot, `pr-diff-${Date.now()}.patch`);
  const diffPatchSaveArgs = [...diffPatchArgs.filter((item) => item !== "--json"), "--save", diffPatchSavePath, "--json"];
  const diffPatchSaveResult = runJson(diffPatchSaveArgs, {
    step: "pr.diff.patch.save",
  });
  if (!isRecord(diffPatchSaveResult) || diffPatchSaveResult.savedTo !== diffPatchSavePath) {
    fail("pr diff --patch --save verification failed: invalid response shape");
  }
  if (!fs.existsSync(diffPatchSavePath)) {
    fail("pr diff --patch --save verification failed: patch file not found");
  }
  if (Array.isArray(diffPatchSaveResult.patches) && diffPatchSaveResult.patches.length > 0) {
    const savedPatchContent = fs.readFileSync(diffPatchSavePath, "utf-8");
    if (!savedPatchContent.trim()) {
      fail("pr diff --patch --save verification failed: patch file content is empty");
    }
  }

  const prReadyResult = runJson(["pr", "ready", repositoryId, localId, "--org", organizationId, "--format", "json"], {
    step: "pr.ready.format.json",
  });
  if (!isRecord(prReadyResult)) {
    fail("pr ready --format json verification failed: invalid response shape");
  }
  const prReadyTsvOutput = runChecked(
    ["node", cliPath, "pr", "ready", repositoryId, localId, "--org", organizationId, "--format", "tsv"],
    {
      cwd: projectRoot,
      env,
      step: "pr.ready.format.tsv",
    }
  ).stdout.trim();
  if (!prReadyTsvOutput.includes("key\tvalue")) {
    fail("pr ready --format tsv verification failed: missing tsv header");
  }
  const prReadyOutPath = path.join(tmpRoot, `pr-ready-${runId}.tsv`);
  runChecked(
    [
      "node",
      cliPath,
      "pr",
      "ready",
      repositoryId,
      localId,
      "--org",
      organizationId,
      "--format",
      "tsv",
      "--out",
      prReadyOutPath,
    ],
    {
      cwd: projectRoot,
      env,
      step: "pr.ready.out.tsv",
    }
  );
  if (!fs.existsSync(prReadyOutPath)) {
    fail("pr ready --out verification failed: output file not found");
  }
  const prReadyOutText = fs.readFileSync(prReadyOutPath, "utf-8");
  if (!prReadyOutText.includes("key\tvalue")) {
    fail("pr ready --out verification failed: missing tsv header");
  }
  runExpectedFailure(
    ["node", cliPath, "pr", "ready", repositoryId, localId, "--org", organizationId, "--format", "bad"],
    {
      cwd: projectRoot,
      env,
      step: "pr.ready.format.invalid",
      contains: "Invalid --format value",
    }
  );
  runExpectedFailure(
    [
      "node",
      cliPath,
      "pr",
      "ready",
      repositoryId,
      localId,
      "--org",
      organizationId,
      "--format",
      "table",
      "--out",
      path.join(tmpRoot, `pr-ready-invalid-out-${runId}.txt`),
    ],
    {
      cwd: projectRoot,
      env,
      step: "pr.ready.out.table.invalid",
      contains: "--out` requires --format tsv/json",
    }
  );

  const prCloseResult = runJson(["pr", "close", repositoryId, localId, "--org", organizationId, "--format", "json"], {
    step: "pr.close.format.json",
  });
  if (!isRecord(prCloseResult)) {
    fail("pr close --format json verification failed: invalid response shape");
  }
  const prReopenResult = runJson(
    ["pr", "reopen", repositoryId, localId, "--org", organizationId, "--format", "json"],
    {
      step: "pr.reopen.format.json",
    }
  );
  if (!isRecord(prReopenResult)) {
    fail("pr reopen --format json verification failed: invalid response shape");
  }
  const prCloseTsvOutput = runChecked(
    ["node", cliPath, "pr", "close", repositoryId, localId, "--org", organizationId, "--format", "tsv"],
    {
      cwd: projectRoot,
      env,
      step: "pr.close.format.tsv",
    }
  ).stdout.trim();
  if (!prCloseTsvOutput.includes("key\tvalue")) {
    fail("pr close --format tsv verification failed: missing tsv header");
  }
  const prReopenTsvOutput = runChecked(
    ["node", cliPath, "pr", "reopen", repositoryId, localId, "--org", organizationId, "--format", "tsv"],
    {
      cwd: projectRoot,
      env,
      step: "pr.reopen.format.tsv",
    }
  ).stdout.trim();
  if (!prReopenTsvOutput.includes("key\tvalue")) {
    fail("pr reopen --format tsv verification failed: missing tsv header");
  }
  const prCloseOutPath = path.join(tmpRoot, `pr-close-${runId}.tsv`);
  runChecked(
    [
      "node",
      cliPath,
      "pr",
      "close",
      repositoryId,
      localId,
      "--org",
      organizationId,
      "--format",
      "tsv",
      "--out",
      prCloseOutPath,
    ],
    {
      cwd: projectRoot,
      env,
      step: "pr.close.out.tsv",
    }
  );
  if (!fs.existsSync(prCloseOutPath)) {
    fail("pr close --out verification failed: output file not found");
  }
  const prCloseOutText = fs.readFileSync(prCloseOutPath, "utf-8");
  if (!prCloseOutText.includes("key\tvalue")) {
    fail("pr close --out verification failed: missing tsv header");
  }
  const prReopenOutPath = path.join(tmpRoot, `pr-reopen-${runId}.tsv`);
  runChecked(
    [
      "node",
      cliPath,
      "pr",
      "reopen",
      repositoryId,
      localId,
      "--org",
      organizationId,
      "--format",
      "tsv",
      "--out",
      prReopenOutPath,
    ],
    {
      cwd: projectRoot,
      env,
      step: "pr.reopen.out.tsv",
    }
  );
  if (!fs.existsSync(prReopenOutPath)) {
    fail("pr reopen --out verification failed: output file not found");
  }
  const prReopenOutText = fs.readFileSync(prReopenOutPath, "utf-8");
  if (!prReopenOutText.includes("key\tvalue")) {
    fail("pr reopen --out verification failed: missing tsv header");
  }
  runExpectedFailure(
    ["node", cliPath, "pr", "close", repositoryId, localId, "--org", organizationId, "--format", "bad"],
    {
      cwd: projectRoot,
      env,
      step: "pr.close.format.invalid",
      contains: "Invalid --format value",
    }
  );
  runExpectedFailure(
    [
      "node",
      cliPath,
      "pr",
      "close",
      repositoryId,
      localId,
      "--org",
      organizationId,
      "--format",
      "table",
      "--out",
      path.join(tmpRoot, `pr-close-invalid-out-${runId}.txt`),
    ],
    {
      cwd: projectRoot,
      env,
      step: "pr.close.out.table.invalid",
      contains: "--out` requires --format tsv/json",
    }
  );
  runExpectedFailure(
    ["node", cliPath, "pr", "reopen", repositoryId, localId, "--org", organizationId, "--format", "bad"],
    {
      cwd: projectRoot,
      env,
      step: "pr.reopen.format.invalid",
      contains: "Invalid --format value",
    }
  );
  runExpectedFailure(
    [
      "node",
      cliPath,
      "pr",
      "reopen",
      repositoryId,
      localId,
      "--org",
      organizationId,
      "--format",
      "table",
      "--out",
      path.join(tmpRoot, `pr-reopen-invalid-out-${runId}.txt`),
    ],
    {
      cwd: projectRoot,
      env,
      step: "pr.reopen.out.table.invalid",
      contains: "--out` requires --format tsv/json",
    }
  );
  note(
    "pr",
    "view/view-format/view-out/list/list-format/list-out/create/create-format/create-out/status/status-format/status-out/checkout/checkout-format/checkout-out/comment/comment-format/comment-out/comment-reply/comment-reply-format/comment-reply-out/comment-edit/comment-edit-format/comment-edit-out/comment-delete/comment-delete-format/comment-delete-out/comment-resolve/comment-resolve-format/comment-resolve-out/comment-unresolve/comment-unresolve-format/comment-unresolve-out/comments/comments-format/comments-summary/comments-out/threads/threads-author/threads-mine/threads-replies/threads-since/threads-contains/threads-sort/threads-limit/threads-ids/threads-format/threads-summary/threads-out/comment-inline/review/review-format/review-out/reviews/reviews-format/reviews-out/checks/checks-format/checks-out/patchsets/patchsets-format/patchsets-out/files/files-format/files-out/edit/edit-format/edit-out/ready/ready-format/ready-out/merge/merge-format/merge-out/close/close-format/close-out/reopen/reopen-format/reopen-out/diff/diff-save"
  );

  const mergeFeatureBranch = `feat/e2e-merge-${Date.now()}`;
  const mergeFileName = "e2e-merge.txt";
  writeText(path.join(clonePath, mergeFileName), `merge e2e at ${new Date().toISOString()}${os.EOL}`);
  runChecked(["git", "-C", clonePath, "checkout", baseBranch], {
    step: "git.merge.checkout-base",
  });
  runChecked(["git", "-C", clonePath, "checkout", "-b", mergeFeatureBranch], {
    step: "git.merge.checkout-feature",
  });
  runChecked(["git", "-C", clonePath, "add", mergeFileName], { step: "git.merge.add" });
  runChecked(["git", "-C", clonePath, "commit", "-m", "test: e2e merge path commit"], {
    step: "git.merge.commit",
  });
  runChecked(
    [
      "git",
      "-C",
      clonePath,
      "-c",
      `http.extraHeader=x-yunxiao-token: ${token}`,
      "push",
      "-u",
      "origin",
      mergeFeatureBranch,
    ],
    { step: "git.merge.push" }
  );

  const mergePrCreated = runJson(
    [
      "pr",
      "create",
      "--repo",
      repositoryId,
      "--org",
      organizationId,
      "--source",
      mergeFeatureBranch,
      "--target",
      baseBranch,
      "--title",
      "e2e merge path pr",
      "--description",
      "merge-path created by scripts/e2e-smoke.mjs",
      "--json",
    ],
    { step: "pr.merge-path.create" }
  );
  const mergePrLocalId = readFirstString(mergePrCreated, ["localId", "iid", "result.localId", "result.iid"]);
  if (!mergePrLocalId) {
    fail("merge-path pr create returned no local id");
  }

  const mergePathSoftFrom = structuredStepReport.length;
  try {
    runJson(
      [
        "pr",
        "review",
        repositoryId,
        mergePrLocalId,
        "--org",
        organizationId,
        "--approve",
        "--body",
        "e2e approve review",
        "--format",
        "json",
      ],
      { step: "pr.merge-path.review.format.json" }
    );
    const prReviewTsvOutput = runChecked(
      [
        "node",
        cliPath,
        "pr",
        "review",
        repositoryId,
        mergePrLocalId,
        "--org",
        organizationId,
        "--approve",
        "--body",
        "e2e review tsv output",
        "--format",
        "tsv",
      ],
      {
        cwd: projectRoot,
        env,
        step: "pr.merge-path.review.format.tsv",
      }
    ).stdout.trim();
    if (!prReviewTsvOutput.includes("key\tvalue")) {
      fail("pr review --format tsv verification failed: missing tsv header");
    }
    const prReviewOutPath = path.join(tmpRoot, `pr-review-${runId}.tsv`);
    runChecked(
      [
        "node",
        cliPath,
        "pr",
        "review",
        repositoryId,
        mergePrLocalId,
        "--org",
        organizationId,
        "--approve",
        "--body",
        "e2e review out",
        "--format",
        "tsv",
        "--out",
        prReviewOutPath,
      ],
      {
        cwd: projectRoot,
        env,
        step: "pr.merge-path.review.out.tsv",
      }
    );
    if (!fs.existsSync(prReviewOutPath)) {
      fail("pr review --out verification failed: output file not found");
    }
    const prReviewOutText = fs.readFileSync(prReviewOutPath, "utf-8");
    if (!prReviewOutText.includes("key\tvalue")) {
      fail("pr review --out verification failed: missing tsv header");
    }
    runExpectedFailure(
      [
        "node",
        cliPath,
        "pr",
        "review",
        repositoryId,
        mergePrLocalId,
        "--org",
        organizationId,
        "--approve",
        "--format",
        "bad",
      ],
      {
        cwd: projectRoot,
        env,
        step: "pr.merge-path.review.format.invalid",
        contains: "Invalid --format value",
      }
    );
    runExpectedFailure(
      [
        "node",
        cliPath,
        "pr",
        "review",
        repositoryId,
        mergePrLocalId,
        "--org",
        organizationId,
        "--approve",
        "--format",
        "table",
        "--out",
        path.join(tmpRoot, `pr-review-invalid-out-${runId}.txt`),
      ],
      {
        cwd: projectRoot,
        env,
        step: "pr.merge-path.review.out.table.invalid",
        contains: "--out` requires --format tsv/json",
      }
    );
    runExpectedFailure(
      [
        "node",
        cliPath,
        "pr",
        "merge",
        repositoryId,
        mergePrLocalId,
        "--org",
        organizationId,
        "--method",
        "no-fast-forward",
        "--format",
        "bad",
      ],
      {
        cwd: projectRoot,
        env,
        step: "pr.merge-path.merge.format.invalid",
        contains: "Invalid --format value",
      }
    );
    runExpectedFailure(
      [
        "node",
        cliPath,
        "pr",
        "merge",
        repositoryId,
        mergePrLocalId,
        "--org",
        organizationId,
        "--method",
        "no-fast-forward",
        "--format",
        "table",
        "--out",
        path.join(tmpRoot, `pr-merge-invalid-out-${runId}.txt`),
      ],
      {
        cwd: projectRoot,
        env,
        step: "pr.merge-path.merge.out.table.invalid",
        contains: "--out` requires --format tsv/json",
      }
    );
    runJson(
      [
        "pr",
        "merge",
        repositoryId,
        mergePrLocalId,
        "--org",
        organizationId,
        "--method",
        "no-fast-forward",
        "--format",
        "json",
      ],
      { step: "pr.merge-path.merge.format.json" }
    );
    runJson(["pr", "view", repositoryId, mergePrLocalId, "--org", organizationId, "--json"], {
      step: "pr.merge-path.view",
    });

    const mergeFormatTsvBranch = `feat/e2e-merge-tsv-${Date.now()}`;
    const mergeFormatTsvFile = `e2e-merge-tsv-${Date.now()}.txt`;
    runChecked(["git", "-C", clonePath, "checkout", baseBranch], {
      step: "git.merge.tsv.checkout-base",
    });
    writeText(path.join(clonePath, mergeFormatTsvFile), `merge tsv at ${new Date().toISOString()}${os.EOL}`);
    runChecked(["git", "-C", clonePath, "checkout", "-b", mergeFormatTsvBranch], {
      step: "git.merge.tsv.checkout-feature",
    });
    runChecked(["git", "-C", clonePath, "add", mergeFormatTsvFile], { step: "git.merge.tsv.add" });
    runChecked(["git", "-C", clonePath, "commit", "-m", "test: e2e merge tsv commit"], {
      step: "git.merge.tsv.commit",
    });
    runChecked(
      [
        "git",
        "-C",
        clonePath,
        "-c",
        `http.extraHeader=x-yunxiao-token: ${token}`,
        "push",
        "-u",
        "origin",
        mergeFormatTsvBranch,
      ],
      { step: "git.merge.tsv.push" }
    );
    const mergeTsvPr = runJson(
      [
        "pr",
        "create",
        "--repo",
        repositoryId,
        "--org",
        organizationId,
        "--source",
        mergeFormatTsvBranch,
        "--target",
        baseBranch,
        "--title",
        `e2e merge tsv pr ${runId}`,
        "--description",
        "merge-path tsv validation",
        "--format",
        "json",
      ],
      { step: "pr.merge-path.tsv.create" }
    );
    const mergeTsvLocalId = readFirstString(mergeTsvPr, ["localId", "iid", "result.localId", "result.iid"]);
    if (!mergeTsvLocalId) {
      fail("merge-path tsv pr create returned no local id");
    }
    runJson(
      [
        "pr",
        "review",
        repositoryId,
        mergeTsvLocalId,
        "--org",
        organizationId,
        "--approve",
        "--body",
        "e2e approve merge tsv",
        "--json",
      ],
      { step: "pr.merge-path.tsv.review" }
    );
    const mergeTsvOutput = runChecked(
      [
        "node",
        cliPath,
        "pr",
        "merge",
        repositoryId,
        mergeTsvLocalId,
        "--org",
        organizationId,
        "--method",
        "no-fast-forward",
        "--format",
        "tsv",
      ],
      {
        cwd: projectRoot,
        env,
        step: "pr.merge-path.merge.format.tsv",
      }
    ).stdout.trim();
    if (!mergeTsvOutput.includes("key\tvalue")) {
      fail("pr merge --format tsv verification failed: missing tsv header");
    }

    const mergeOutBranch = `feat/e2e-merge-out-${Date.now()}`;
    const mergeOutFile = `e2e-merge-out-${Date.now()}.txt`;
    runChecked(["git", "-C", clonePath, "checkout", baseBranch], {
      step: "git.merge.out.checkout-base",
    });
    writeText(path.join(clonePath, mergeOutFile), `merge out at ${new Date().toISOString()}${os.EOL}`);
    runChecked(["git", "-C", clonePath, "checkout", "-b", mergeOutBranch], {
      step: "git.merge.out.checkout-feature",
    });
    runChecked(["git", "-C", clonePath, "add", mergeOutFile], { step: "git.merge.out.add" });
    runChecked(["git", "-C", clonePath, "commit", "-m", "test: e2e merge out commit"], {
      step: "git.merge.out.commit",
    });
    runChecked(
      [
        "git",
        "-C",
        clonePath,
        "-c",
        `http.extraHeader=x-yunxiao-token: ${token}`,
        "push",
        "-u",
        "origin",
        mergeOutBranch,
      ],
      { step: "git.merge.out.push" }
    );
    const mergeOutPr = runJson(
      [
        "pr",
        "create",
        "--repo",
        repositoryId,
        "--org",
        organizationId,
        "--source",
        mergeOutBranch,
        "--target",
        baseBranch,
        "--title",
        `e2e merge out pr ${runId}`,
        "--description",
        "merge-path out validation",
        "--format",
        "json",
      ],
      { step: "pr.merge-path.out.create" }
    );
    const mergeOutLocalId = readFirstString(mergeOutPr, ["localId", "iid", "result.localId", "result.iid"]);
    if (!mergeOutLocalId) {
      fail("merge-path out pr create returned no local id");
    }
    runJson(
      [
        "pr",
        "review",
        repositoryId,
        mergeOutLocalId,
        "--org",
        organizationId,
        "--approve",
        "--body",
        "e2e approve merge out",
        "--json",
      ],
      { step: "pr.merge-path.out.review" }
    );
    const mergeOutPath = path.join(tmpRoot, `pr-merge-${runId}.tsv`);
    runChecked(
      [
        "node",
        cliPath,
        "pr",
        "merge",
        repositoryId,
        mergeOutLocalId,
        "--org",
        organizationId,
        "--method",
        "no-fast-forward",
        "--format",
        "tsv",
        "--out",
        mergeOutPath,
      ],
      {
        cwd: projectRoot,
        env,
        step: "pr.merge-path.merge.out.tsv",
      }
    );
    if (!fs.existsSync(mergeOutPath)) {
      fail("pr merge --out verification failed: output file not found");
    }
    const mergeOutText = fs.readFileSync(mergeOutPath, "utf-8");
    if (!mergeOutText.includes("key\tvalue")) {
      fail("pr merge --out verification failed: missing tsv header");
    }
    note("pr.merge-path", `review+merge localId=${mergePrLocalId}`);
  } catch (error) {
    for (let i = mergePathSoftFrom; i < structuredStepReport.length; i += 1) {
      const item = structuredStepReport[i];
      if (item && item.step && String(item.step).startsWith("pr.merge-path.") && item.status === "FAIL") {
        item.status = "SOFT_FAIL";
      }
    }
    warnings.push(`pr merge path skipped: ${sanitizeText(error instanceof Error ? error.message : String(error))}`);
  }

  const projects = runJson(
    ["org", "projects", "--org", organizationId, "--scenario", "participate", "--json"],
    {
      step: "org.projects",
    }
  );

  const participatedProjects = extractRecordArray(projects);
  if (participatedProjects.length > 0) {
    projectId = readFirstString(participatedProjects[0], ["id", "identifier", "spaceId", "projectId"]);
  }

  if (!projectId) {
    const allProjects = runJson(["org", "projects", "--org", organizationId, "--json"], {
      step: "org.projects.all",
    });
    const allProjectItems = extractRecordArray(allProjects);
    if (allProjectItems.length > 0) {
      projectId = readFirstString(allProjectItems[0], ["id", "identifier", "spaceId", "projectId"]);
    }
  }

  if (!projectId) {
    try {
      const templates = runJson(["org", "project-templates", "--org", organizationId, "--json"], {
        step: "org.project-templates",
      });
      const templateItems = extractRecordArray(templates);
      const templateId =
        (templateItems.length > 0 &&
          readFirstString(templateItems[0], ["id", "identifier", "templateId", "templateIdentifier"])) ||
        undefined;
      if (templateId) {
        const autoProjectName = `yx-e2e-project-${Date.now()}`;
        const createdProject = runJson(
          [
            "org",
            "project-create",
            "--org",
            organizationId,
            "--name",
            autoProjectName,
            "--template-id",
            templateId,
            "--description",
            "created by scripts/e2e-smoke.mjs for sprint/issue coverage",
            "--json",
          ],
          {
            step: "org.project-create",
          }
        );
        projectId = readFirstString(createdProject, [
          "id",
          "identifier",
          "projectId",
          "spaceId",
          "result.id",
          "result.identifier",
        ]);
        if (projectId) {
          projectCreatedBySmoke = true;
          projectNameCreatedBySmoke = autoProjectName;
          note("org.project-create", `${autoProjectName} (${projectId})`);
        }
      }
    } catch (error) {
      warnings.push(
        `auto project create skipped: ${sanitizeText(error instanceof Error ? error.message : String(error))}`
      );
    }
  }

  const orgProjectLifecycleSoftFrom = structuredStepReport.length;
  let lifecycleProjectId;
  let lifecycleProjectName;
  try {
    const lifecycleTemplates = runJson(["org", "project-templates", "--org", organizationId, "--format", "json"], {
      step: "org.project-lifecycle.templates.format.json",
    });
    const lifecycleTemplateItems = extractRecordArray(lifecycleTemplates);
    const lifecycleTemplateId =
      (lifecycleTemplateItems.length > 0 &&
        readFirstString(lifecycleTemplateItems[0], ["id", "identifier", "templateId", "templateIdentifier"])) ||
      undefined;
    if (!lifecycleTemplateId) {
      throw new Error("no project template available for project-create/project-delete format/out smoke");
    }

    lifecycleProjectName = `yx-e2e-org-format-${Date.now()}`;
    const lifecycleCustomCode = randomUppercaseCode(6);
    const lifecycleCreateOutPath = path.join(tmpRoot, `org-project-create-${runId}.json`);
    runChecked(
      [
        "node",
        cliPath,
        "org",
        "project-create",
        "--org",
        organizationId,
        "--name",
        lifecycleProjectName,
        "--template-id",
        lifecycleTemplateId,
        "--custom-code",
        lifecycleCustomCode,
        "--description",
        "created by scripts/e2e-smoke.mjs for org format/out coverage",
        "--format",
        "json",
        "--out",
        lifecycleCreateOutPath,
      ],
      {
        cwd: projectRoot,
        env,
        step: "org.project-lifecycle.create.out.json",
      }
    );
    if (!fs.existsSync(lifecycleCreateOutPath)) {
      fail("org project-create --out verification failed: output file not found");
    }
    const lifecycleCreateData = JSON.parse(fs.readFileSync(lifecycleCreateOutPath, "utf-8"));
    lifecycleProjectId = readFirstString(lifecycleCreateData, [
      "id",
      "identifier",
      "projectId",
      "spaceId",
      "result.id",
      "result.identifier",
    ]);
    if (!lifecycleProjectId) {
      fail("org project-create --out verification failed: output missing project id");
    }

    const lifecycleDeleteOutPath = path.join(tmpRoot, `org-project-delete-${runId}.tsv`);
    runChecked(
      [
        "node",
        cliPath,
        "org",
        "project-delete",
        lifecycleProjectId,
        "--org",
        organizationId,
        "--name",
        lifecycleProjectName,
        "--yes",
        "--format",
        "tsv",
        "--out",
        lifecycleDeleteOutPath,
      ],
      {
        cwd: projectRoot,
        env,
        step: "org.project-lifecycle.delete.out.tsv",
      }
    );
    lifecycleProjectId = undefined;
    lifecycleProjectName = undefined;
    if (!fs.existsSync(lifecycleDeleteOutPath)) {
      fail("org project-delete --out verification failed: output file not found");
    }
    const lifecycleDeleteText = fs.readFileSync(lifecycleDeleteOutPath, "utf-8");
    if (!lifecycleDeleteText.includes("key\tvalue")) {
      fail("org project-delete --out verification failed: missing tsv header");
    }
    runExpectedFailure(
      [
        "node",
        cliPath,
        "org",
        "project-create",
        "--org",
        organizationId,
        "--name",
        `yx-e2e-org-format-invalid-${runId}`,
        "--template-id",
        lifecycleTemplateId,
        "--format",
        "bad",
      ],
      {
        cwd: projectRoot,
        env,
        step: "org.project-lifecycle.create.format.invalid",
        contains: "Invalid --format value",
      }
    );
    runExpectedFailure(
      [
        "node",
        cliPath,
        "org",
        "project-create",
        "--org",
        organizationId,
        "--name",
        `yx-e2e-org-format-invalid-out-${runId}`,
        "--template-id",
        lifecycleTemplateId,
        "--format",
        "table",
        "--out",
        path.join(tmpRoot, `org-project-create-invalid-out-${runId}.txt`),
      ],
      {
        cwd: projectRoot,
        env,
        step: "org.project-lifecycle.create.out.table.invalid",
        contains: "--out` requires --format tsv/json",
      }
    );
    runExpectedFailure(
      ["node", cliPath, "org", "project-delete", lifecycleCustomCode, "--org", organizationId, "--yes", "--format", "bad"],
      {
        cwd: projectRoot,
        env,
        step: "org.project-lifecycle.delete.format.invalid",
        contains: "Invalid --format value",
      }
    );
    runExpectedFailure(
      [
        "node",
        cliPath,
        "org",
        "project-delete",
        lifecycleCustomCode,
        "--org",
        organizationId,
        "--yes",
        "--format",
        "table",
        "--out",
        path.join(tmpRoot, `org-project-delete-invalid-out-${runId}.txt`),
      ],
      {
        cwd: projectRoot,
        env,
        step: "org.project-lifecycle.delete.out.table.invalid",
        contains: "--out` requires --format tsv/json",
      }
    );

    note("org.project-lifecycle", "project-create/project-delete format/out + invalid");
  } catch (error) {
    if (organizationId && lifecycleProjectId && lifecycleProjectName) {
      runSoft(
        [
          "org",
          "project-delete",
          lifecycleProjectId,
          "--org",
          organizationId,
          "--name",
          lifecycleProjectName,
          "--yes",
          "--json",
        ],
        "cleanup.org.project-lifecycle.delete",
        warnings
      );
    }
    for (let i = orgProjectLifecycleSoftFrom; i < structuredStepReport.length; i += 1) {
      const item = structuredStepReport[i];
      if (item && item.step && String(item.step).startsWith("org.project-lifecycle.") && item.status === "FAIL") {
        item.status = "SOFT_FAIL";
      }
    }
    warnings.push(
      `org project-create/project-delete format/out tests skipped: ${sanitizeText(error instanceof Error ? error.message : String(error))}`
    );
  }

  if (!projectId) {
    warnings.push("sprint tests skipped: no project found in organization.");
  } else {
    const orgDefaultContextSoftFrom = structuredStepReport.length;
    try {
      const orgUseDefaultContext = runJson(["org", "use", organizationId, "--project", projectId, "--json"], {
        step: "org.default-context.use.json",
      });
      if (
        !isRecord(orgUseDefaultContext) ||
        orgUseDefaultContext.updated !== true ||
        !isRecord(orgUseDefaultContext.defaults) ||
        orgUseDefaultContext.defaults.organizationId !== organizationId ||
        orgUseDefaultContext.defaults.projectId !== projectId
      ) {
        fail("org use for default-context verification failed: invalid response shape");
      }

      const orgProjectsByDefault = runJson(["org", "projects", "--per-page", "20", "--format", "json"], {
        step: "org.default-context.projects.format.json",
      });
      if (!Array.isArray(orgProjectsByDefault) && !isRecord(orgProjectsByDefault)) {
        fail("org projects default-context --format json verification failed: invalid response shape");
      }

      const orgMembersByDefault = runJson(["org", "members", "--per-page", "20", "--format", "json"], {
        step: "org.default-context.members.format.json",
      });
      if (!Array.isArray(orgMembersByDefault) && !isRecord(orgMembersByDefault)) {
        fail("org members default-context --format json verification failed: invalid response shape");
      }

      const orgProjectRolesByDefault = runJson(["org", "project-roles", "--format", "json"], {
        step: "org.default-context.project-roles.format.json",
      });
      if (!Array.isArray(orgProjectRolesByDefault) && !isRecord(orgProjectRolesByDefault)) {
        fail("org project-roles default-context --format json verification failed: invalid response shape");
      }

      const orgProjectMembersByDefault = runJson(["org", "project-members", "--format", "json"], {
        step: "org.default-context.project-members.format.json",
      });
      if (!Array.isArray(orgProjectMembersByDefault) && !isRecord(orgProjectMembersByDefault)) {
        fail("org project-members default-context --format json verification failed: invalid response shape");
      }

      note("org.default-context", "projects/members/project-roles/project-members via defaults");
    } catch (error) {
      for (let i = orgDefaultContextSoftFrom; i < structuredStepReport.length; i += 1) {
        const item = structuredStepReport[i];
        if (item && item.step && String(item.step).startsWith("org.default-context.") && item.status === "FAIL") {
          item.status = "SOFT_FAIL";
        }
      }
      warnings.push(
        `org default-context tests skipped: ${sanitizeText(error instanceof Error ? error.message : String(error))}`
      );
    }

    const sprintSoftFrom = structuredStepReport.length;
    try {
      const sprintList = runJson(
        ["sprint", "list", "--org", organizationId, "--project", projectId, "--per-page", "20", "--json"],
        {
          step: "sprint.list",
        }
      );
      const sprintItems = extractSprintRecords(sprintList);
      const sprintListFormatJson = runJson(
        ["sprint", "list", "--org", organizationId, "--project", projectId, "--per-page", "20", "--format", "json"],
        {
          step: "sprint.list.format.json",
        }
      );
      if (!Array.isArray(sprintListFormatJson)) {
        fail("sprint list --format json verification failed: invalid response shape");
      }
      const sprintListFormatTsvOutput = runChecked(
        ["node", cliPath, "sprint", "list", "--org", organizationId, "--project", projectId, "--per-page", "20", "--format", "tsv"],
        {
          cwd: projectRoot,
          env,
          step: "sprint.list.format.tsv",
        }
      ).stdout.trim();
      if (!sprintListFormatTsvOutput.includes("id\tidentifier\tname\tstatus\towners\tstartDate\tendDate\tcreatedAt\tupdatedAt")) {
        fail("sprint list --format tsv verification failed: missing tsv header");
      }
      const sprintListOutPath = path.join(tmpRoot, `sprint-list-${runId}.tsv`);
      runChecked(
        [
          "node",
          cliPath,
          "sprint",
          "list",
          "--org",
          organizationId,
          "--project",
          projectId,
          "--per-page",
          "20",
          "--format",
          "tsv",
          "--out",
          sprintListOutPath,
        ],
        {
          cwd: projectRoot,
          env,
          step: "sprint.list.out.tsv",
        }
      );
      if (!fs.existsSync(sprintListOutPath)) {
        fail("sprint list --out verification failed: output file not found");
      }
      const sprintListOutText = fs.readFileSync(sprintListOutPath, "utf-8");
      if (!sprintListOutText.includes("id\tidentifier\tname\tstatus\towners\tstartDate\tendDate\tcreatedAt\tupdatedAt")) {
        fail("sprint list --out verification failed: missing tsv header");
      }
      runExpectedFailure(
        ["node", cliPath, "sprint", "list", "--org", organizationId, "--project", projectId, "--format", "bad"],
        {
          cwd: projectRoot,
          env,
          step: "sprint.list.format.invalid",
          contains: "Invalid --format value",
        }
      );
      runExpectedFailure(
        [
          "node",
          cliPath,
          "sprint",
          "list",
          "--org",
          organizationId,
          "--project",
          projectId,
          "--format",
          "table",
          "--out",
          path.join(tmpRoot, `sprint-list-invalid-out-${runId}.txt`),
        ],
        {
          cwd: projectRoot,
          env,
          step: "sprint.list.out.table.invalid",
          contains: "--out` requires --format tsv/json",
        }
      );
      let sprintViewTargetId = readFirstString(sprintItems[0], ["identifier", "id", "sprintId"]);
      if (projectCreatedBySmoke) {
        const dateText = new Date().toISOString().slice(0, 10);
        const sprintName = `yx-e2e-sprint-${Date.now()}`;
        const createdSprint = runJson(
          [
            "sprint",
            "create",
            "--org",
            organizationId,
            "--project",
            projectId,
            "--name",
            sprintName,
            "--start-date",
            dateText,
            "--end-date",
            dateText,
            "--json",
          ],
          {
            step: "sprint.create",
          }
        );
        const sprintId = readFirstString(createdSprint, [
          "id",
          "identifier",
          "sprintId",
          "result.id",
          "result.identifier",
        ]);
        if (!sprintViewTargetId) {
          sprintViewTargetId = sprintId;
        }
        const sprintCreateFormatTsvOutput = runChecked(
          [
            "node",
            cliPath,
            "sprint",
            "create",
            "--org",
            organizationId,
            "--project",
            projectId,
            "--name",
            `${sprintName}-fmt-tsv`,
            "--start-date",
            dateText,
            "--end-date",
            dateText,
            "--format",
            "tsv",
          ],
          {
            cwd: projectRoot,
            env,
            step: "sprint.create.format.tsv",
          }
        ).stdout.trim();
        if (!sprintCreateFormatTsvOutput.includes("key\tvalue")) {
          fail("sprint create --format tsv verification failed: missing tsv header");
        }
        const sprintCreateOutPath = path.join(tmpRoot, `sprint-create-${runId}.json`);
        runChecked(
          [
            "node",
            cliPath,
            "sprint",
            "create",
            "--org",
            organizationId,
            "--project",
            projectId,
            "--name",
            `${sprintName}-out-json`,
            "--start-date",
            dateText,
            "--end-date",
            dateText,
            "--format",
            "json",
            "--out",
            sprintCreateOutPath,
          ],
          {
            cwd: projectRoot,
            env,
            step: "sprint.create.out.json",
          }
        );
        if (!fs.existsSync(sprintCreateOutPath)) {
          fail("sprint create --out verification failed: output file not found");
        }
        const sprintCreateOutJson = JSON.parse(fs.readFileSync(sprintCreateOutPath, "utf-8"));
        if (!readFirstString(sprintCreateOutJson, ["id", "identifier", "sprintId"])) {
          fail("sprint create --out verification failed: sprint id not found");
        }
        runExpectedFailure(
          [
            "node",
            cliPath,
            "sprint",
            "create",
            "--org",
            organizationId,
            "--project",
            projectId,
            "--name",
            `${sprintName}-invalid`,
            "--format",
            "bad",
          ],
          {
            cwd: projectRoot,
            env,
            step: "sprint.create.format.invalid",
            contains: "Invalid --format value",
          }
        );
        runExpectedFailure(
          [
            "node",
            cliPath,
            "sprint",
            "create",
            "--org",
            organizationId,
            "--project",
            projectId,
            "--name",
            `${sprintName}-invalid-out`,
            "--format",
            "table",
            "--out",
            path.join(tmpRoot, `sprint-create-invalid-out-${runId}.txt`),
          ],
          {
            cwd: projectRoot,
            env,
            step: "sprint.create.out.table.invalid",
            contains: "--out` requires --format tsv/json",
          }
        );
        if (sprintId) {
          runJson(["sprint", "view", sprintId, "--org", organizationId, "--project", projectId, "--json"], {
            step: "sprint.view",
          });
          const sprintViewFormatJson = runJson(
            ["sprint", "view", sprintId, "--org", organizationId, "--project", projectId, "--format", "json"],
            {
              step: "sprint.view.format.json",
            }
          );
          if (!isRecord(sprintViewFormatJson)) {
            fail("sprint view --format json verification failed: invalid response shape");
          }
          const sprintViewFormatTsvOutput = runChecked(
            ["node", cliPath, "sprint", "view", sprintId, "--org", organizationId, "--project", projectId, "--format", "tsv"],
            {
              cwd: projectRoot,
              env,
              step: "sprint.view.format.tsv",
            }
          ).stdout.trim();
          if (!sprintViewFormatTsvOutput.includes("key\tvalue")) {
            fail("sprint view --format tsv verification failed: missing tsv header");
          }
          const sprintViewOutPath = path.join(tmpRoot, `sprint-view-${runId}.tsv`);
          runChecked(
            [
              "node",
              cliPath,
              "sprint",
              "view",
              sprintId,
              "--org",
              organizationId,
              "--project",
              projectId,
              "--format",
              "tsv",
              "--out",
              sprintViewOutPath,
            ],
            {
              cwd: projectRoot,
              env,
              step: "sprint.view.out.tsv",
            }
          );
          if (!fs.existsSync(sprintViewOutPath)) {
            fail("sprint view --out verification failed: output file not found");
          }
          const sprintViewOutText = fs.readFileSync(sprintViewOutPath, "utf-8");
          if (!sprintViewOutText.includes("key\tvalue")) {
            fail("sprint view --out verification failed: missing tsv header");
          }
          runExpectedFailure(
            ["node", cliPath, "sprint", "view", sprintId, "--org", organizationId, "--project", projectId, "--format", "bad"],
            {
              cwd: projectRoot,
              env,
              step: "sprint.view.format.invalid",
              contains: "Invalid --format value",
            }
          );
          runExpectedFailure(
            [
              "node",
              cliPath,
              "sprint",
              "view",
              sprintId,
              "--org",
              organizationId,
              "--project",
              projectId,
              "--format",
              "table",
              "--out",
              path.join(tmpRoot, `sprint-view-invalid-out-${runId}.txt`),
            ],
            {
              cwd: projectRoot,
              env,
              step: "sprint.view.out.table.invalid",
              contains: "--out` requires --format tsv/json",
            }
          );
          runJson(
            [
              "sprint",
              "update",
              sprintId,
              "--org",
              organizationId,
              "--project",
              projectId,
              "--name",
              `${sprintName}-updated`,
              "--description",
              "updated by scripts/e2e-smoke.mjs",
              "--format",
              "json",
            ],
            {
              step: "sprint.update",
            }
          );
          const sprintUpdateFormatTsvOutput = runChecked(
            [
              "node",
              cliPath,
              "sprint",
              "update",
              sprintId,
              "--org",
              organizationId,
              "--project",
              projectId,
              "--name",
              `${sprintName}-updated-tsv`,
              "--description",
              "updated by scripts/e2e-smoke.mjs tsv",
              "--format",
              "tsv",
            ],
            {
              cwd: projectRoot,
              env,
              step: "sprint.update.format.tsv",
            }
          ).stdout.trim();
          if (!sprintUpdateFormatTsvOutput.includes("key\tvalue")) {
            fail("sprint update --format tsv verification failed: missing tsv header");
          }
          const sprintUpdateOutPath = path.join(tmpRoot, `sprint-update-${runId}.tsv`);
          runChecked(
            [
              "node",
              cliPath,
              "sprint",
              "update",
              sprintId,
              "--org",
              organizationId,
              "--project",
              projectId,
              "--name",
              `${sprintName}-updated-out`,
              "--description",
              "updated by scripts/e2e-smoke.mjs out",
              "--format",
              "tsv",
              "--out",
              sprintUpdateOutPath,
            ],
            {
              cwd: projectRoot,
              env,
              step: "sprint.update.out.tsv",
            }
          );
          if (!fs.existsSync(sprintUpdateOutPath)) {
            fail("sprint update --out verification failed: output file not found");
          }
          const sprintUpdateOutText = fs.readFileSync(sprintUpdateOutPath, "utf-8");
          if (!sprintUpdateOutText.includes("key\tvalue")) {
            fail("sprint update --out verification failed: missing tsv header");
          }
          runExpectedFailure(
            [
              "node",
              cliPath,
              "sprint",
              "update",
              sprintId,
              "--org",
              organizationId,
              "--project",
              projectId,
              "--name",
              `${sprintName}-invalid`,
              "--format",
              "bad",
            ],
            {
              cwd: projectRoot,
              env,
              step: "sprint.update.format.invalid",
              contains: "Invalid --format value",
            }
          );
          runExpectedFailure(
            [
              "node",
              cliPath,
              "sprint",
              "update",
              sprintId,
              "--org",
              organizationId,
              "--project",
              projectId,
              "--name",
              `${sprintName}-invalid-out`,
              "--format",
              "table",
              "--out",
              path.join(tmpRoot, `sprint-update-invalid-out-${runId}.txt`),
            ],
            {
              cwd: projectRoot,
              env,
              step: "sprint.update.out.table.invalid",
              contains: "--out` requires --format tsv/json",
            }
          );
        }
      } else if (sprintViewTargetId) {
        runJson(["sprint", "view", sprintViewTargetId, "--org", organizationId, "--project", projectId, "--json"], {
          step: "sprint.view",
        });
        const sprintViewFormatJson = runJson(
          ["sprint", "view", sprintViewTargetId, "--org", organizationId, "--project", projectId, "--format", "json"],
          {
            step: "sprint.view.format.json",
          }
        );
        if (!isRecord(sprintViewFormatJson)) {
          fail("sprint view --format json verification failed: invalid response shape");
        }
        const sprintViewFormatTsvOutput = runChecked(
          ["node", cliPath, "sprint", "view", sprintViewTargetId, "--org", organizationId, "--project", projectId, "--format", "tsv"],
          {
            cwd: projectRoot,
            env,
            step: "sprint.view.format.tsv",
          }
        ).stdout.trim();
        if (!sprintViewFormatTsvOutput.includes("key\tvalue")) {
          fail("sprint view --format tsv verification failed: missing tsv header");
        }
        const sprintViewOutPath = path.join(tmpRoot, `sprint-view-${runId}.tsv`);
        runChecked(
          [
            "node",
            cliPath,
            "sprint",
            "view",
            sprintViewTargetId,
            "--org",
            organizationId,
            "--project",
            projectId,
            "--format",
            "tsv",
            "--out",
            sprintViewOutPath,
          ],
          {
            cwd: projectRoot,
            env,
            step: "sprint.view.out.tsv",
          }
        );
        if (!fs.existsSync(sprintViewOutPath)) {
          fail("sprint view --out verification failed: output file not found");
        }
        const sprintViewOutText = fs.readFileSync(sprintViewOutPath, "utf-8");
        if (!sprintViewOutText.includes("key\tvalue")) {
          fail("sprint view --out verification failed: missing tsv header");
        }
        runExpectedFailure(
          ["node", cliPath, "sprint", "view", sprintViewTargetId, "--org", organizationId, "--project", projectId, "--format", "bad"],
          {
            cwd: projectRoot,
            env,
            step: "sprint.view.format.invalid",
            contains: "Invalid --format value",
          }
        );
        runExpectedFailure(
          [
            "node",
            cliPath,
            "sprint",
            "view",
            sprintViewTargetId,
            "--org",
            organizationId,
            "--project",
            projectId,
            "--format",
            "table",
            "--out",
            path.join(tmpRoot, `sprint-view-invalid-out-${runId}.txt`),
          ],
          {
            cwd: projectRoot,
            env,
            step: "sprint.view.out.table.invalid",
            contains: "--out` requires --format tsv/json",
          }
        );
      }
      note(
        "sprint",
        `list/list-format/list-out${sprintViewTargetId ? "/view/view-format/view-out" : ""}${projectCreatedBySmoke ? "/create/create-format/create-out/update/update-format/update-out" : ""}`
      );
    } catch (error) {
      for (let i = sprintSoftFrom; i < structuredStepReport.length; i += 1) {
        const item = structuredStepReport[i];
        if (item && item.step && String(item.step).startsWith("sprint.") && item.status === "FAIL") {
          item.status = "SOFT_FAIL";
        }
      }
      warnings.push(`sprint tests skipped: ${sanitizeText(error instanceof Error ? error.message : String(error))}`);
    }
  }

  if (!projectId) {
    warnings.push("milestone tests skipped: no project found in organization.");
    warnings.push("version tests skipped: no project found in organization.");
    warnings.push("workitem tests skipped: no project found in organization.");
    warnings.push("org project-member tests skipped: no project found in organization.");
    warnings.push("issue tests skipped: no project found in organization.");
  } else {
    const milestoneSoftFrom = structuredStepReport.length;
    try {
      const milestoneList = runJson(
        ["milestone", "list", "--org", organizationId, "--project", projectId, "--per-page", "20", "--json"],
        {
          step: "milestone.list",
        }
      );
      const milestoneItems = extractMilestoneRecords(milestoneList);
      const milestoneListFormatJson = runJson(
        ["milestone", "list", "--org", organizationId, "--project", projectId, "--per-page", "20", "--format", "json"],
        {
          step: "milestone.list.format.json",
        }
      );
      if (!Array.isArray(milestoneListFormatJson)) {
        fail("milestone list --format json verification failed: invalid response shape");
      }
      const milestoneListFormatTsvOutput = runChecked(
        ["node", cliPath, "milestone", "list", "--org", organizationId, "--project", projectId, "--per-page", "20", "--format", "tsv"],
        {
          cwd: projectRoot,
          env,
          step: "milestone.list.format.tsv",
        }
      ).stdout.trim();
      if (!milestoneListFormatTsvOutput.includes("id\tsubject\tstatus\tassignedTo\tplanEndDate\tactualEndDate\tcreatedAt\tupdatedAt")) {
        fail("milestone list --format tsv verification failed: missing tsv header");
      }
      const milestoneListOutPath = path.join(tmpRoot, `milestone-list-${runId}.tsv`);
      runChecked(
        [
          "node",
          cliPath,
          "milestone",
          "list",
          "--org",
          organizationId,
          "--project",
          projectId,
          "--per-page",
          "20",
          "--format",
          "tsv",
          "--out",
          milestoneListOutPath,
        ],
        {
          cwd: projectRoot,
          env,
          step: "milestone.list.out.tsv",
        }
      );
      if (!fs.existsSync(milestoneListOutPath)) {
        fail("milestone list --out verification failed: output file not found");
      }
      const milestoneListOutText = fs.readFileSync(milestoneListOutPath, "utf-8");
      if (!milestoneListOutText.includes("id\tsubject\tstatus\tassignedTo\tplanEndDate\tactualEndDate\tcreatedAt\tupdatedAt")) {
        fail("milestone list --out verification failed: missing tsv header");
      }
      runExpectedFailure(
        ["node", cliPath, "milestone", "list", "--org", organizationId, "--project", projectId, "--format", "bad"],
        {
          cwd: projectRoot,
          env,
          step: "milestone.list.format.invalid",
          contains: "Invalid --format value",
        }
      );
      runExpectedFailure(
        [
          "node",
          cliPath,
          "milestone",
          "list",
          "--org",
          organizationId,
          "--project",
          projectId,
          "--format",
          "table",
          "--out",
          path.join(tmpRoot, `milestone-list-invalid-out-${runId}.txt`),
        ],
        {
          cwd: projectRoot,
          env,
          step: "milestone.list.out.table.invalid",
          contains: "--out` requires --format tsv/json",
        }
      );

      const milestoneOffsetDays = (Number(runId) % 3200) + 1;
      const dateText = new Date(Date.now() + milestoneOffsetDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const milestoneSubject = `yx-e2e-milestone-${Date.now()}`;
      const createdMilestone = runJson(
        [
          "milestone",
          "create",
          "--org",
          organizationId,
          "--project",
          projectId,
          "--subject",
          milestoneSubject,
          "--plan-end-date",
          dateText,
          "--json",
        ],
        {
          step: "milestone.create",
        }
      );
      const milestoneId = readFirstString(createdMilestone, [
        "id",
        "identifier",
        "milestoneId",
        "result.id",
        "result.identifier",
      ]);
      if (milestoneId) {
        runJson(
          ["milestone", "view", milestoneId, "--org", organizationId, "--project", projectId, "--json"],
          {
            step: "milestone.view",
          }
        );
        const milestoneViewFormatJson = runJson(
          ["milestone", "view", milestoneId, "--org", organizationId, "--project", projectId, "--format", "json"],
          {
            step: "milestone.view.format.json",
          }
        );
        if (!isRecord(milestoneViewFormatJson) || !readFirstString(milestoneViewFormatJson, ["id", "identifier", "milestoneId"])) {
          fail("milestone view --format json verification failed: invalid response shape");
        }
        const milestoneViewFormatTsvOutput = runChecked(
          ["node", cliPath, "milestone", "view", milestoneId, "--org", organizationId, "--project", projectId, "--format", "tsv"],
          {
            cwd: projectRoot,
            env,
            step: "milestone.view.format.tsv",
          }
        ).stdout.trim();
        if (!milestoneViewFormatTsvOutput.includes("key\tvalue")) {
          fail("milestone view --format tsv verification failed: missing tsv header");
        }
        const milestoneViewOutPath = path.join(tmpRoot, `milestone-view-${runId}.tsv`);
        runChecked(
          [
            "node",
            cliPath,
            "milestone",
            "view",
            milestoneId,
            "--org",
            organizationId,
            "--project",
            projectId,
            "--format",
            "tsv",
            "--out",
            milestoneViewOutPath,
          ],
          {
            cwd: projectRoot,
            env,
            step: "milestone.view.out.tsv",
          }
        );
        if (!fs.existsSync(milestoneViewOutPath)) {
          fail("milestone view --out verification failed: output file not found");
        }
        const milestoneViewOutText = fs.readFileSync(milestoneViewOutPath, "utf-8");
        if (!milestoneViewOutText.includes("key\tvalue")) {
          fail("milestone view --out verification failed: missing tsv header");
        }
        runExpectedFailure(
          ["node", cliPath, "milestone", "view", milestoneId, "--org", organizationId, "--project", projectId, "--format", "bad"],
          {
            cwd: projectRoot,
            env,
            step: "milestone.view.format.invalid",
            contains: "Invalid --format value",
          }
        );
        runExpectedFailure(
          [
            "node",
            cliPath,
            "milestone",
            "view",
            milestoneId,
            "--org",
            organizationId,
            "--project",
            projectId,
            "--format",
            "table",
            "--out",
            path.join(tmpRoot, `milestone-view-invalid-out-${runId}.txt`),
          ],
          {
            cwd: projectRoot,
            env,
            step: "milestone.view.out.table.invalid",
            contains: "--out` requires --format tsv/json",
          }
        );

        const milestoneCreateFormatTsvOutput = runChecked(
          [
            "node",
            cliPath,
            "milestone",
            "create",
            "--org",
            organizationId,
            "--project",
            projectId,
            "--subject",
            `${milestoneSubject}-fmt-tsv`,
            "--plan-end-date",
            dateText,
            "--format",
            "tsv",
          ],
          {
            cwd: projectRoot,
            env,
            step: "milestone.create.format.tsv",
          }
        ).stdout.trim();
        if (!milestoneCreateFormatTsvOutput.includes("key\tvalue")) {
          fail("milestone create --format tsv verification failed: missing tsv header");
        }
        const milestoneCreateFormatTsvId =
          readTsvValue(milestoneCreateFormatTsvOutput, "id") ?? readTsvValue(milestoneCreateFormatTsvOutput, "milestoneId");
        if (!milestoneCreateFormatTsvId) {
          fail("milestone create --format tsv verification failed: milestone id not found");
        }
        runJson(
          ["milestone", "delete", milestoneCreateFormatTsvId, "--org", organizationId, "--project", projectId, "--yes", "--json"],
          {
            step: "milestone.create.format.tsv.cleanup",
          }
        );
        const milestoneCreateOutPath = path.join(tmpRoot, `milestone-create-${runId}.json`);
        runChecked(
          [
            "node",
            cliPath,
            "milestone",
            "create",
            "--org",
            organizationId,
            "--project",
            projectId,
            "--subject",
            `${milestoneSubject}-out-json`,
            "--plan-end-date",
            dateText,
            "--format",
            "json",
            "--out",
            milestoneCreateOutPath,
          ],
          {
            cwd: projectRoot,
            env,
            step: "milestone.create.out.json",
          }
        );
        if (!fs.existsSync(milestoneCreateOutPath)) {
          fail("milestone create --out verification failed: output file not found");
        }
        const milestoneCreateOutJson = JSON.parse(fs.readFileSync(milestoneCreateOutPath, "utf-8"));
        const milestoneCreateOutId = readFirstString(milestoneCreateOutJson, ["id", "identifier", "milestoneId"]);
        if (!milestoneCreateOutId) {
          fail("milestone create --out verification failed: milestone id not found");
        }
        runJson(
          ["milestone", "delete", milestoneCreateOutId, "--org", organizationId, "--project", projectId, "--yes", "--json"],
          {
            step: "milestone.create.out.cleanup",
          }
        );
        runExpectedFailure(
          [
            "node",
            cliPath,
            "milestone",
            "create",
            "--org",
            organizationId,
            "--project",
            projectId,
            "--subject",
            `${milestoneSubject}-invalid`,
            "--plan-end-date",
            dateText,
            "--format",
            "bad",
          ],
          {
            cwd: projectRoot,
            env,
            step: "milestone.create.format.invalid",
            contains: "Invalid --format value",
          }
        );
        runExpectedFailure(
          [
            "node",
            cliPath,
            "milestone",
            "create",
            "--org",
            organizationId,
            "--project",
            projectId,
            "--subject",
            `${milestoneSubject}-invalid-out`,
            "--plan-end-date",
            dateText,
            "--format",
            "table",
            "--out",
            path.join(tmpRoot, `milestone-create-invalid-out-${runId}.txt`),
          ],
          {
            cwd: projectRoot,
            env,
            step: "milestone.create.out.table.invalid",
            contains: "--out` requires --format tsv/json",
          }
        );

        runJson(
          [
            "milestone",
            "update",
            milestoneId,
            "--org",
            organizationId,
            "--project",
            projectId,
            "--subject",
            `${milestoneSubject}-updated`,
            "--description",
            "updated by scripts/e2e-smoke.mjs",
            "--format",
            "json",
          ],
          {
            step: "milestone.update",
          }
        );
        const milestoneUpdateFormatTsvOutput = runChecked(
          [
            "node",
            cliPath,
            "milestone",
            "update",
            milestoneId,
            "--org",
            organizationId,
            "--project",
            projectId,
            "--subject",
            `${milestoneSubject}-updated-tsv`,
            "--description",
            "updated by scripts/e2e-smoke.mjs tsv",
            "--format",
            "tsv",
          ],
          {
            cwd: projectRoot,
            env,
            step: "milestone.update.format.tsv",
          }
        ).stdout.trim();
        if (!milestoneUpdateFormatTsvOutput.includes("key\tvalue")) {
          fail("milestone update --format tsv verification failed: missing tsv header");
        }
        const milestoneUpdateOutPath = path.join(tmpRoot, `milestone-update-${runId}.tsv`);
        runChecked(
          [
            "node",
            cliPath,
            "milestone",
            "update",
            milestoneId,
            "--org",
            organizationId,
            "--project",
            projectId,
            "--subject",
            `${milestoneSubject}-updated-out`,
            "--description",
            "updated by scripts/e2e-smoke.mjs out",
            "--format",
            "tsv",
            "--out",
            milestoneUpdateOutPath,
          ],
          {
            cwd: projectRoot,
            env,
            step: "milestone.update.out.tsv",
          }
        );
        if (!fs.existsSync(milestoneUpdateOutPath)) {
          fail("milestone update --out verification failed: output file not found");
        }
        const milestoneUpdateOutText = fs.readFileSync(milestoneUpdateOutPath, "utf-8");
        if (!milestoneUpdateOutText.includes("key\tvalue")) {
          fail("milestone update --out verification failed: missing tsv header");
        }
        runExpectedFailure(
          [
            "node",
            cliPath,
            "milestone",
            "update",
            milestoneId,
            "--org",
            organizationId,
            "--project",
            projectId,
            "--subject",
            `${milestoneSubject}-invalid`,
            "--format",
            "bad",
          ],
          {
            cwd: projectRoot,
            env,
            step: "milestone.update.format.invalid",
            contains: "Invalid --format value",
          }
        );
        runExpectedFailure(
          [
            "node",
            cliPath,
            "milestone",
            "update",
            milestoneId,
            "--org",
            organizationId,
            "--project",
            projectId,
            "--subject",
            `${milestoneSubject}-invalid-out`,
            "--format",
            "table",
            "--out",
            path.join(tmpRoot, `milestone-update-invalid-out-${runId}.txt`),
          ],
          {
            cwd: projectRoot,
            env,
            step: "milestone.update.out.table.invalid",
            contains: "--out` requires --format tsv/json",
          }
        );

        const milestoneDeleteFormatJsonSeed = runJson(
          [
            "milestone",
            "create",
            "--org",
            organizationId,
            "--project",
            projectId,
            "--subject",
            `${milestoneSubject}-delete-json`,
            "--plan-end-date",
            dateText,
            "--json",
          ],
          {
            step: "milestone.delete.format.json.seed",
          }
        );
        const milestoneDeleteFormatJsonId = readFirstString(milestoneDeleteFormatJsonSeed, [
          "id",
          "identifier",
          "milestoneId",
          "result.id",
          "result.identifier",
        ]);
        if (!milestoneDeleteFormatJsonId) {
          fail("milestone delete --format json setup failed: milestone id not found");
        }
        const milestoneDeleteFormatJsonResult = runJson(
          [
            "milestone",
            "delete",
            milestoneDeleteFormatJsonId,
            "--org",
            organizationId,
            "--project",
            projectId,
            "--yes",
            "--format",
            "json",
          ],
          {
            step: "milestone.delete.format.json",
          }
        );
        if (!isRecord(milestoneDeleteFormatJsonResult) || !readFirstString(milestoneDeleteFormatJsonResult, ["method"])) {
          fail("milestone delete --format json verification failed: invalid response shape");
        }

        const milestoneDeleteFormatTsvSeed = runJson(
          [
            "milestone",
            "create",
            "--org",
            organizationId,
            "--project",
            projectId,
            "--subject",
            `${milestoneSubject}-delete-tsv`,
            "--plan-end-date",
            dateText,
            "--json",
          ],
          {
            step: "milestone.delete.format.tsv.seed",
          }
        );
        const milestoneDeleteFormatTsvId = readFirstString(milestoneDeleteFormatTsvSeed, [
          "id",
          "identifier",
          "milestoneId",
          "result.id",
          "result.identifier",
        ]);
        if (!milestoneDeleteFormatTsvId) {
          fail("milestone delete --format tsv setup failed: milestone id not found");
        }
        const milestoneDeleteFormatTsvOutput = runChecked(
          [
            "node",
            cliPath,
            "milestone",
            "delete",
            milestoneDeleteFormatTsvId,
            "--org",
            organizationId,
            "--project",
            projectId,
            "--yes",
            "--format",
            "tsv",
          ],
          {
            cwd: projectRoot,
            env,
            step: "milestone.delete.format.tsv",
          }
        ).stdout.trim();
        if (!milestoneDeleteFormatTsvOutput.includes("key\tvalue")) {
          fail("milestone delete --format tsv verification failed: missing tsv header");
        }

        const milestoneDeleteOutSeed = runJson(
          [
            "milestone",
            "create",
            "--org",
            organizationId,
            "--project",
            projectId,
            "--subject",
            `${milestoneSubject}-delete-out`,
            "--plan-end-date",
            dateText,
            "--json",
          ],
          {
            step: "milestone.delete.out.seed",
          }
        );
        const milestoneDeleteOutId = readFirstString(milestoneDeleteOutSeed, [
          "id",
          "identifier",
          "milestoneId",
          "result.id",
          "result.identifier",
        ]);
        if (!milestoneDeleteOutId) {
          fail("milestone delete --out setup failed: milestone id not found");
        }
        const milestoneDeleteOutPath = path.join(tmpRoot, `milestone-delete-${runId}.tsv`);
        runChecked(
          [
            "node",
            cliPath,
            "milestone",
            "delete",
            milestoneDeleteOutId,
            "--org",
            organizationId,
            "--project",
            projectId,
            "--yes",
            "--format",
            "tsv",
            "--out",
            milestoneDeleteOutPath,
          ],
          {
            cwd: projectRoot,
            env,
            step: "milestone.delete.out.tsv",
          }
        );
        if (!fs.existsSync(milestoneDeleteOutPath)) {
          fail("milestone delete --out verification failed: output file not found");
        }
        const milestoneDeleteOutText = fs.readFileSync(milestoneDeleteOutPath, "utf-8");
        if (!milestoneDeleteOutText.includes("key\tvalue")) {
          fail("milestone delete --out verification failed: missing tsv header");
        }
        runExpectedFailure(
          [
            "node",
            cliPath,
            "milestone",
            "delete",
            milestoneId,
            "--org",
            organizationId,
            "--project",
            projectId,
            "--yes",
            "--format",
            "bad",
          ],
          {
            cwd: projectRoot,
            env,
            step: "milestone.delete.format.invalid",
            contains: "Invalid --format value",
          }
        );
        runExpectedFailure(
          [
            "node",
            cliPath,
            "milestone",
            "delete",
            milestoneId,
            "--org",
            organizationId,
            "--project",
            projectId,
            "--yes",
            "--format",
            "table",
            "--out",
            path.join(tmpRoot, `milestone-delete-invalid-out-${runId}.txt`),
          ],
          {
            cwd: projectRoot,
            env,
            step: "milestone.delete.out.table.invalid",
            contains: "--out` requires --format tsv/json",
          }
        );

        runJson(
          [
            "milestone",
            "delete",
            milestoneId,
            "--org",
            organizationId,
            "--project",
            projectId,
            "--yes",
            "--json",
          ],
          {
            step: "milestone.delete",
          }
        );
      }
      note("milestone", "list/list-format/list-out/view/view-format/view-out/create/create-format/create-out/update/update-format/update-out/delete/delete-format/delete-out");
    } catch (error) {
      for (let i = milestoneSoftFrom; i < structuredStepReport.length; i += 1) {
        const item = structuredStepReport[i];
        if (item && item.step && String(item.step).startsWith("milestone.") && item.status === "FAIL") {
          item.status = "SOFT_FAIL";
        }
      }
      warnings.push(`milestone tests skipped: ${sanitizeText(error instanceof Error ? error.message : String(error))}`);
    }

    const versionSoftFrom = structuredStepReport.length;
    try {
      const versionList = runJson(
        ["version", "list", "--org", organizationId, "--project", projectId, "--per-page", "20", "--json"],
        {
          step: "version.list",
        }
      );
      const versionItems = extractVersionRecords(versionList);
      const versionListFormatJson = runJson(
        ["version", "list", "--org", organizationId, "--project", projectId, "--per-page", "20", "--format", "json"],
        {
          step: "version.list.format.json",
        }
      );
      if (!Array.isArray(versionListFormatJson)) {
        fail("version list --format json verification failed: invalid response shape");
      }
      const versionListFormatTsvOutput = runChecked(
        ["node", cliPath, "version", "list", "--org", organizationId, "--project", projectId, "--per-page", "20", "--format", "tsv"],
        {
          cwd: projectRoot,
          env,
          step: "version.list.format.tsv",
        }
      ).stdout.trim();
      if (!versionListFormatTsvOutput.includes("id\tname\tstatus\towners\tstartDate\tpublishDate\tcreatedAt\tupdatedAt")) {
        fail("version list --format tsv verification failed: missing tsv header");
      }
      const versionListOutPath = path.join(tmpRoot, `version-list-${runId}.tsv`);
      runChecked(
        [
          "node",
          cliPath,
          "version",
          "list",
          "--org",
          organizationId,
          "--project",
          projectId,
          "--per-page",
          "20",
          "--format",
          "tsv",
          "--out",
          versionListOutPath,
        ],
        {
          cwd: projectRoot,
          env,
          step: "version.list.out.tsv",
        }
      );
      if (!fs.existsSync(versionListOutPath)) {
        fail("version list --out verification failed: output file not found");
      }
      const versionListOutText = fs.readFileSync(versionListOutPath, "utf-8");
      if (!versionListOutText.includes("id\tname\tstatus\towners\tstartDate\tpublishDate\tcreatedAt\tupdatedAt")) {
        fail("version list --out verification failed: missing tsv header");
      }
      runExpectedFailure(
        ["node", cliPath, "version", "list", "--org", organizationId, "--project", projectId, "--format", "bad"],
        {
          cwd: projectRoot,
          env,
          step: "version.list.format.invalid",
          contains: "Invalid --format value",
        }
      );
      runExpectedFailure(
        [
          "node",
          cliPath,
          "version",
          "list",
          "--org",
          organizationId,
          "--project",
          projectId,
          "--format",
          "table",
          "--out",
          path.join(tmpRoot, `version-list-invalid-out-${runId}.txt`),
        ],
        {
          cwd: projectRoot,
          env,
          step: "version.list.out.table.invalid",
          contains: "--out` requires --format tsv/json",
        }
      );

      const dateText = new Date().toISOString().slice(0, 10);
      const versionName = `yx-e2e-version-${Date.now()}`;
      const createdVersion = runJson(
        [
          "version",
          "create",
          "--org",
          organizationId,
          "--project",
          projectId,
          "--name",
          versionName,
          "--start-date",
          dateText,
          "--publish-date",
          dateText,
          "--json",
        ],
        {
          step: "version.create",
        }
      );
      const versionCreateFormatTsvOutput = runChecked(
        [
          "node",
          cliPath,
          "version",
          "create",
          "--org",
          organizationId,
          "--project",
          projectId,
          "--name",
          `${versionName}-fmt-tsv`,
          "--start-date",
          dateText,
          "--publish-date",
          dateText,
          "--format",
          "tsv",
        ],
        {
          cwd: projectRoot,
          env,
          step: "version.create.format.tsv",
        }
      ).stdout.trim();
      if (!versionCreateFormatTsvOutput.includes("key\tvalue")) {
        fail("version create --format tsv verification failed: missing tsv header");
      }
      const versionCreateFormatTsvId =
        readTsvValue(versionCreateFormatTsvOutput, "id") ?? readTsvValue(versionCreateFormatTsvOutput, "versionId");
      if (!versionCreateFormatTsvId) {
        fail("version create --format tsv verification failed: version id not found");
      }
      runJson(
        ["version", "delete", versionCreateFormatTsvId, "--org", organizationId, "--project", projectId, "--yes", "--json"],
        {
          step: "version.create.format.tsv.cleanup",
        }
      );
      const versionCreateOutPath = path.join(tmpRoot, `version-create-${runId}.json`);
      runChecked(
        [
          "node",
          cliPath,
          "version",
          "create",
          "--org",
          organizationId,
          "--project",
          projectId,
          "--name",
          `${versionName}-out-json`,
          "--start-date",
          dateText,
          "--publish-date",
          dateText,
          "--format",
          "json",
          "--out",
          versionCreateOutPath,
        ],
        {
          cwd: projectRoot,
          env,
          step: "version.create.out.json",
        }
      );
      if (!fs.existsSync(versionCreateOutPath)) {
        fail("version create --out verification failed: output file not found");
      }
      const versionCreateOutJson = JSON.parse(fs.readFileSync(versionCreateOutPath, "utf-8"));
      const versionCreateOutId = readFirstString(versionCreateOutJson, ["id", "identifier", "versionId"]);
      if (!versionCreateOutId) {
        fail("version create --out verification failed: version id not found");
      }
      runJson(
        ["version", "delete", versionCreateOutId, "--org", organizationId, "--project", projectId, "--yes", "--json"],
        {
          step: "version.create.out.cleanup",
        }
      );
      runExpectedFailure(
        [
          "node",
          cliPath,
          "version",
          "create",
          "--org",
          organizationId,
          "--project",
          projectId,
          "--name",
          `${versionName}-invalid`,
          "--format",
          "bad",
        ],
        {
          cwd: projectRoot,
          env,
          step: "version.create.format.invalid",
          contains: "Invalid --format value",
        }
      );
      runExpectedFailure(
        [
          "node",
          cliPath,
          "version",
          "create",
          "--org",
          organizationId,
          "--project",
          projectId,
          "--name",
          `${versionName}-invalid-out`,
          "--format",
          "table",
          "--out",
          path.join(tmpRoot, `version-create-invalid-out-${runId}.txt`),
        ],
        {
          cwd: projectRoot,
          env,
          step: "version.create.out.table.invalid",
          contains: "--out` requires --format tsv/json",
        }
      );
      const versionId = readFirstString(createdVersion, [
        "id",
        "identifier",
        "versionId",
        "result.id",
        "result.identifier",
      ]);
      if (versionId) {
        runJson(["version", "view", versionId, "--org", organizationId, "--project", projectId, "--json"], {
          step: "version.view",
        });
        const versionViewFormatJson = runJson(
          ["version", "view", versionId, "--org", organizationId, "--project", projectId, "--format", "json"],
          {
            step: "version.view.format.json",
          }
        );
        if (!isRecord(versionViewFormatJson) || !readFirstString(versionViewFormatJson, ["id", "identifier", "versionId"])) {
          fail("version view --format json verification failed: invalid response shape");
        }
        const versionViewFormatTsvOutput = runChecked(
          ["node", cliPath, "version", "view", versionId, "--org", organizationId, "--project", projectId, "--format", "tsv"],
          {
            cwd: projectRoot,
            env,
            step: "version.view.format.tsv",
          }
        ).stdout.trim();
        if (!versionViewFormatTsvOutput.includes("key\tvalue")) {
          fail("version view --format tsv verification failed: missing tsv header");
        }
        const versionViewOutPath = path.join(tmpRoot, `version-view-${runId}.tsv`);
        runChecked(
          [
            "node",
            cliPath,
            "version",
            "view",
            versionId,
            "--org",
            organizationId,
            "--project",
            projectId,
            "--format",
            "tsv",
            "--out",
            versionViewOutPath,
          ],
          {
            cwd: projectRoot,
            env,
            step: "version.view.out.tsv",
          }
        );
        if (!fs.existsSync(versionViewOutPath)) {
          fail("version view --out verification failed: output file not found");
        }
        const versionViewOutText = fs.readFileSync(versionViewOutPath, "utf-8");
        if (!versionViewOutText.includes("key\tvalue")) {
          fail("version view --out verification failed: missing tsv header");
        }
        runExpectedFailure(
          ["node", cliPath, "version", "view", versionId, "--org", organizationId, "--project", projectId, "--format", "bad"],
          {
            cwd: projectRoot,
            env,
            step: "version.view.format.invalid",
            contains: "Invalid --format value",
          }
        );
        runExpectedFailure(
          [
            "node",
            cliPath,
            "version",
            "view",
            versionId,
            "--org",
            organizationId,
            "--project",
            projectId,
            "--format",
            "table",
            "--out",
            path.join(tmpRoot, `version-view-invalid-out-${runId}.txt`),
          ],
          {
            cwd: projectRoot,
            env,
            step: "version.view.out.table.invalid",
            contains: "--out` requires --format tsv/json",
          }
        );

        runJson(
          [
            "version",
            "update",
            versionId,
            "--org",
            organizationId,
            "--project",
            projectId,
            "--name",
            `${versionName}-updated`,
            "--start-date",
            dateText,
            "--publish-date",
            dateText,
            "--format",
            "json",
          ],
          {
            step: "version.update",
          }
        );
        const versionUpdateFormatTsvOutput = runChecked(
          [
            "node",
            cliPath,
            "version",
            "update",
            versionId,
            "--org",
            organizationId,
            "--project",
            projectId,
            "--name",
            `${versionName}-updated-tsv`,
            "--start-date",
            dateText,
            "--publish-date",
            dateText,
            "--format",
            "tsv",
          ],
          {
            cwd: projectRoot,
            env,
            step: "version.update.format.tsv",
          }
        ).stdout.trim();
        if (!versionUpdateFormatTsvOutput.includes("key\tvalue")) {
          fail("version update --format tsv verification failed: missing tsv header");
        }
        const versionUpdateOutPath = path.join(tmpRoot, `version-update-${runId}.tsv`);
        runChecked(
          [
            "node",
            cliPath,
            "version",
            "update",
            versionId,
            "--org",
            organizationId,
            "--project",
            projectId,
            "--name",
            `${versionName}-updated-out`,
            "--start-date",
            dateText,
            "--publish-date",
            dateText,
            "--format",
            "tsv",
            "--out",
            versionUpdateOutPath,
          ],
          {
            cwd: projectRoot,
            env,
            step: "version.update.out.tsv",
          }
        );
        if (!fs.existsSync(versionUpdateOutPath)) {
          fail("version update --out verification failed: output file not found");
        }
        const versionUpdateOutText = fs.readFileSync(versionUpdateOutPath, "utf-8");
        if (!versionUpdateOutText.includes("key\tvalue")) {
          fail("version update --out verification failed: missing tsv header");
        }
        runExpectedFailure(
          [
            "node",
            cliPath,
            "version",
            "update",
            versionId,
            "--org",
            organizationId,
            "--project",
            projectId,
            "--name",
            `${versionName}-invalid`,
            "--format",
            "bad",
          ],
          {
            cwd: projectRoot,
            env,
            step: "version.update.format.invalid",
            contains: "Invalid --format value",
          }
        );
        runExpectedFailure(
          [
            "node",
            cliPath,
            "version",
            "update",
            versionId,
            "--org",
            organizationId,
            "--project",
            projectId,
            "--name",
            `${versionName}-invalid-out`,
            "--format",
            "table",
            "--out",
            path.join(tmpRoot, `version-update-invalid-out-${runId}.txt`),
          ],
          {
            cwd: projectRoot,
            env,
            step: "version.update.out.table.invalid",
            contains: "--out` requires --format tsv/json",
          }
        );

        const versionDeleteFormatJsonSeed = runJson(
          [
            "version",
            "create",
            "--org",
            organizationId,
            "--project",
            projectId,
            "--name",
            `${versionName}-delete-json`,
            "--start-date",
            dateText,
            "--publish-date",
            dateText,
            "--json",
          ],
          {
            step: "version.delete.format.json.seed",
          }
        );
        const versionDeleteFormatJsonId = readFirstString(versionDeleteFormatJsonSeed, [
          "id",
          "identifier",
          "versionId",
          "result.id",
          "result.identifier",
        ]);
        if (!versionDeleteFormatJsonId) {
          fail("version delete --format json setup failed: version id not found");
        }
        const versionDeleteFormatJsonResult = runJson(
          [
            "version",
            "delete",
            versionDeleteFormatJsonId,
            "--org",
            organizationId,
            "--project",
            projectId,
            "--yes",
            "--format",
            "json",
          ],
          {
            step: "version.delete.format.json",
          }
        );
        if (!isRecord(versionDeleteFormatJsonResult) || !readFirstString(versionDeleteFormatJsonResult, ["versionId"])) {
          fail("version delete --format json verification failed: invalid response shape");
        }

        const versionDeleteFormatTsvSeed = runJson(
          [
            "version",
            "create",
            "--org",
            organizationId,
            "--project",
            projectId,
            "--name",
            `${versionName}-delete-tsv`,
            "--start-date",
            dateText,
            "--publish-date",
            dateText,
            "--json",
          ],
          {
            step: "version.delete.format.tsv.seed",
          }
        );
        const versionDeleteFormatTsvId = readFirstString(versionDeleteFormatTsvSeed, [
          "id",
          "identifier",
          "versionId",
          "result.id",
          "result.identifier",
        ]);
        if (!versionDeleteFormatTsvId) {
          fail("version delete --format tsv setup failed: version id not found");
        }
        const versionDeleteFormatTsvOutput = runChecked(
          [
            "node",
            cliPath,
            "version",
            "delete",
            versionDeleteFormatTsvId,
            "--org",
            organizationId,
            "--project",
            projectId,
            "--yes",
            "--format",
            "tsv",
          ],
          {
            cwd: projectRoot,
            env,
            step: "version.delete.format.tsv",
          }
        ).stdout.trim();
        if (!versionDeleteFormatTsvOutput.includes("key\tvalue")) {
          fail("version delete --format tsv verification failed: missing tsv header");
        }

        const versionDeleteOutSeed = runJson(
          [
            "version",
            "create",
            "--org",
            organizationId,
            "--project",
            projectId,
            "--name",
            `${versionName}-delete-out`,
            "--start-date",
            dateText,
            "--publish-date",
            dateText,
            "--json",
          ],
          {
            step: "version.delete.out.seed",
          }
        );
        const versionDeleteOutId = readFirstString(versionDeleteOutSeed, [
          "id",
          "identifier",
          "versionId",
          "result.id",
          "result.identifier",
        ]);
        if (!versionDeleteOutId) {
          fail("version delete --out setup failed: version id not found");
        }
        const versionDeleteOutPath = path.join(tmpRoot, `version-delete-${runId}.tsv`);
        runChecked(
          [
            "node",
            cliPath,
            "version",
            "delete",
            versionDeleteOutId,
            "--org",
            organizationId,
            "--project",
            projectId,
            "--yes",
            "--format",
            "tsv",
            "--out",
            versionDeleteOutPath,
          ],
          {
            cwd: projectRoot,
            env,
            step: "version.delete.out.tsv",
          }
        );
        if (!fs.existsSync(versionDeleteOutPath)) {
          fail("version delete --out verification failed: output file not found");
        }
        const versionDeleteOutText = fs.readFileSync(versionDeleteOutPath, "utf-8");
        if (!versionDeleteOutText.includes("key\tvalue")) {
          fail("version delete --out verification failed: missing tsv header");
        }
        runExpectedFailure(
          [
            "node",
            cliPath,
            "version",
            "delete",
            versionId,
            "--org",
            organizationId,
            "--project",
            projectId,
            "--yes",
            "--format",
            "bad",
          ],
          {
            cwd: projectRoot,
            env,
            step: "version.delete.format.invalid",
            contains: "Invalid --format value",
          }
        );
        runExpectedFailure(
          [
            "node",
            cliPath,
            "version",
            "delete",
            versionId,
            "--org",
            organizationId,
            "--project",
            projectId,
            "--yes",
            "--format",
            "table",
            "--out",
            path.join(tmpRoot, `version-delete-invalid-out-${runId}.txt`),
          ],
          {
            cwd: projectRoot,
            env,
            step: "version.delete.out.table.invalid",
            contains: "--out` requires --format tsv/json",
          }
        );

        runJson(
          [
            "version",
            "delete",
            versionId,
            "--org",
            organizationId,
            "--project",
            projectId,
            "--yes",
            "--json",
          ],
          {
            step: "version.delete",
          }
        );
      }
      note("version", "list/list-format/list-out/view/view-format/view-out/create/create-format/create-out/update/update-format/update-out/delete/delete-format/delete-out");
    } catch (error) {
      for (let i = versionSoftFrom; i < structuredStepReport.length; i += 1) {
        const item = structuredStepReport[i];
        if (item && item.step && String(item.step).startsWith("version.") && item.status === "FAIL") {
          item.status = "SOFT_FAIL";
        }
      }
      warnings.push(`version tests skipped: ${sanitizeText(error instanceof Error ? error.message : String(error))}`);
    }

    const projectRoleSoftFrom = structuredStepReport.length;
    try {
      const orgRoles = runJson(["org", "roles", "--org", organizationId, "--json"], {
        step: "org.roles",
      });
      const projectRoles = runJson(["org", "project-roles", "--org", organizationId, "--project", projectId, "--json"], {
        step: "org.project-roles",
      });
      const projectRolesFormatJson = runJson(
        ["org", "project-roles", "--org", organizationId, "--project", projectId, "--format", "json"],
        {
          step: "org.project-roles.format.json",
        }
      );
      if (!Array.isArray(projectRolesFormatJson) && !isRecord(projectRolesFormatJson)) {
        fail("org project-roles --format json verification failed: invalid response shape");
      }
      const projectRolesFormatTsvOutput = runChecked(
        ["node", cliPath, "org", "project-roles", "--org", organizationId, "--project", projectId, "--format", "tsv"],
        {
          cwd: projectRoot,
          env,
          step: "org.project-roles.format.tsv",
        }
      ).stdout.trim();
      if (!projectRolesFormatTsvOutput) {
        fail("org project-roles --format tsv verification failed: empty output");
      }
      const projectRolesOutPath = path.join(tmpRoot, `org-project-roles-${runId}.tsv`);
      runChecked(
        [
          "node",
          cliPath,
          "org",
          "project-roles",
          "--org",
          organizationId,
          "--project",
          projectId,
          "--format",
          "tsv",
          "--out",
          projectRolesOutPath,
        ],
        {
          cwd: projectRoot,
          env,
          step: "org.project-roles.out.tsv",
        }
      );
      if (!fs.existsSync(projectRolesOutPath)) {
        fail("org project-roles --out verification failed: output file not found");
      }
      runExpectedFailure(
        ["node", cliPath, "org", "project-roles", "--org", organizationId, "--project", projectId, "--format", "bad"],
        {
          cwd: projectRoot,
          env,
          step: "org.project-roles.format.invalid",
          contains: "Invalid --format value",
        }
      );
      runExpectedFailure(
        [
          "node",
          cliPath,
          "org",
          "project-roles",
          "--org",
          organizationId,
          "--project",
          projectId,
          "--format",
          "table",
          "--out",
          path.join(tmpRoot, `org-project-roles-invalid-out-${runId}.txt`),
        ],
        {
          cwd: projectRoot,
          env,
          step: "org.project-roles.out.table.invalid",
          contains: "--out` requires --format tsv/json",
        }
      );

      const roleToAdd = chooseProjectRoleForSmoke({
        orgRoleIds: extractRoleIds(orgRoles),
        projectRoleIds: extractRoleIds(projectRoles),
      });

      if (!roleToAdd) {
        warnings.push("org project-role tests skipped: no role available for add/remove flow.");
      } else {
        const projectRoleAddFormatJson = runJson(
          [
            "org",
            "project-role-add",
            "--org",
            organizationId,
            "--project",
            projectId,
            "--role",
            roleToAdd,
            "--format",
            "json",
          ],
          {
            step: "org.project-role-add.format.json",
          }
        );
        if (!isRecord(projectRoleAddFormatJson)) {
          fail("org project-role-add --format json verification failed: invalid response shape");
        }
        runJson(
          [
            "org",
            "project-role-remove",
            "--org",
            organizationId,
            "--project",
            projectId,
            "--role",
            roleToAdd,
            "--yes",
            "--json",
          ],
          {
            step: "org.project-role-add.format.json.cleanup",
          }
        );

        const projectRoleAddFormatTsvOutput = runChecked(
          [
            "node",
            cliPath,
            "org",
            "project-role-add",
            "--org",
            organizationId,
            "--project",
            projectId,
            "--role",
            roleToAdd,
            "--format",
            "tsv",
          ],
          {
            cwd: projectRoot,
            env,
            step: "org.project-role-add.format.tsv",
          }
        ).stdout.trim();
        if (!projectRoleAddFormatTsvOutput.includes("key\tvalue")) {
          fail("org project-role-add --format tsv verification failed: missing tsv header");
        }
        runJson(
          [
            "org",
            "project-role-remove",
            "--org",
            organizationId,
            "--project",
            projectId,
            "--role",
            roleToAdd,
            "--yes",
            "--json",
          ],
          {
            step: "org.project-role-add.format.tsv.cleanup",
          }
        );

        const projectRoleAddOutPath = path.join(tmpRoot, `org-project-role-add-${runId}.tsv`);
        runChecked(
          [
            "node",
            cliPath,
            "org",
            "project-role-add",
            "--org",
            organizationId,
            "--project",
            projectId,
            "--role",
            roleToAdd,
            "--format",
            "tsv",
            "--out",
            projectRoleAddOutPath,
          ],
          {
            cwd: projectRoot,
            env,
            step: "org.project-role-add.out.tsv",
          }
        );
        if (!fs.existsSync(projectRoleAddOutPath)) {
          fail("org project-role-add --out verification failed: output file not found");
        }
        const projectRoleAddOutText = fs.readFileSync(projectRoleAddOutPath, "utf-8");
        if (!projectRoleAddOutText.includes("key\tvalue")) {
          fail("org project-role-add --out verification failed: missing tsv header");
        }
        runJson(
          [
            "org",
            "project-role-remove",
            "--org",
            organizationId,
            "--project",
            projectId,
            "--role",
            roleToAdd,
            "--yes",
            "--json",
          ],
          {
            step: "org.project-role-add.out.tsv.cleanup",
          }
        );
        runExpectedFailure(
          [
            "node",
            cliPath,
            "org",
            "project-role-add",
            "--org",
            organizationId,
            "--project",
            projectId,
            "--role",
            roleToAdd,
            "--format",
            "bad",
          ],
          {
            cwd: projectRoot,
            env,
            step: "org.project-role-add.format.invalid",
            contains: "Invalid --format value",
          }
        );
        runExpectedFailure(
          [
            "node",
            cliPath,
            "org",
            "project-role-add",
            "--org",
            organizationId,
            "--project",
            projectId,
            "--role",
            roleToAdd,
            "--format",
            "table",
            "--out",
            path.join(tmpRoot, `org-project-role-add-invalid-out-${runId}.txt`),
          ],
          {
            cwd: projectRoot,
            env,
            step: "org.project-role-add.out.table.invalid",
            contains: "--out` requires --format tsv/json",
          }
        );

        runJson(
          [
            "org",
            "project-role-add",
            "--org",
            organizationId,
            "--project",
            projectId,
            "--role",
            roleToAdd,
            "--json",
          ],
          {
            step: "org.project-role-remove.format.json.seed",
          }
        );
        const projectRoleRemoveFormatJson = runJson(
          [
            "org",
            "project-role-remove",
            "--org",
            organizationId,
            "--project",
            projectId,
            "--role",
            roleToAdd,
            "--yes",
            "--format",
            "json",
          ],
          {
            step: "org.project-role-remove.format.json",
          }
        );
        if (!isRecord(projectRoleRemoveFormatJson)) {
          fail("org project-role-remove --format json verification failed: invalid response shape");
        }

        runJson(
          [
            "org",
            "project-role-add",
            "--org",
            organizationId,
            "--project",
            projectId,
            "--role",
            roleToAdd,
            "--json",
          ],
          {
            step: "org.project-role-remove.format.tsv.seed",
          }
        );
        const projectRoleRemoveFormatTsvOutput = runChecked(
          [
            "node",
            cliPath,
            "org",
            "project-role-remove",
            "--org",
            organizationId,
            "--project",
            projectId,
            "--role",
            roleToAdd,
            "--yes",
            "--format",
            "tsv",
          ],
          {
            cwd: projectRoot,
            env,
            step: "org.project-role-remove.format.tsv",
          }
        ).stdout.trim();
        if (!projectRoleRemoveFormatTsvOutput.includes("key\tvalue")) {
          fail("org project-role-remove --format tsv verification failed: missing tsv header");
        }

        runJson(
          [
            "org",
            "project-role-add",
            "--org",
            organizationId,
            "--project",
            projectId,
            "--role",
            roleToAdd,
            "--json",
          ],
          {
            step: "org.project-role-remove.out.tsv.seed",
          }
        );
        const projectRoleRemoveOutPath = path.join(tmpRoot, `org-project-role-remove-${runId}.tsv`);
        runChecked(
          [
            "node",
            cliPath,
            "org",
            "project-role-remove",
            "--org",
            organizationId,
            "--project",
            projectId,
            "--role",
            roleToAdd,
            "--yes",
            "--format",
            "tsv",
            "--out",
            projectRoleRemoveOutPath,
          ],
          {
            cwd: projectRoot,
            env,
            step: "org.project-role-remove.out.tsv",
          }
        );
        if (!fs.existsSync(projectRoleRemoveOutPath)) {
          fail("org project-role-remove --out verification failed: output file not found");
        }
        const projectRoleRemoveOutText = fs.readFileSync(projectRoleRemoveOutPath, "utf-8");
        if (!projectRoleRemoveOutText.includes("key\tvalue")) {
          fail("org project-role-remove --out verification failed: missing tsv header");
        }
        runExpectedFailure(
          [
            "node",
            cliPath,
            "org",
            "project-role-remove",
            "--org",
            organizationId,
            "--project",
            projectId,
            "--role",
            roleToAdd,
            "--yes",
            "--format",
            "bad",
          ],
          {
            cwd: projectRoot,
            env,
            step: "org.project-role-remove.format.invalid",
            contains: "Invalid --format value",
          }
        );
        runExpectedFailure(
          [
            "node",
            cliPath,
            "org",
            "project-role-remove",
            "--org",
            organizationId,
            "--project",
            projectId,
            "--role",
            roleToAdd,
            "--yes",
            "--format",
            "table",
            "--out",
            path.join(tmpRoot, `org-project-role-remove-invalid-out-${runId}.txt`),
          ],
          {
            cwd: projectRoot,
            env,
            step: "org.project-role-remove.out.table.invalid",
            contains: "--out` requires --format tsv/json",
          }
        );

        note("org.project-role", `roles/add/remove/add-format/add-out/remove-format/remove-out (${roleToAdd})`);
      }
    } catch (error) {
      for (let i = projectRoleSoftFrom; i < structuredStepReport.length; i += 1) {
        const item = structuredStepReport[i];
        if (!item || item.status !== "FAIL") {
          continue;
        }
        if (item.step === "org.roles" || item.step === "org.project-roles" || String(item.step).startsWith("org.project-role")) {
          item.status = "SOFT_FAIL";
        }
      }
      warnings.push(`org project-role tests skipped: ${sanitizeText(error instanceof Error ? error.message : String(error))}`);
    }

    const projectMemberSoftFrom = structuredStepReport.length;
    try {
      runJson(["org", "project-members", "--org", organizationId, "--project", projectId, "--json"], {
        step: "org.project-members",
      });
      const projectMembersFormatJson = runJson(
        ["org", "project-members", "--org", organizationId, "--project", projectId, "--format", "json"],
        {
          step: "org.project-members.format.json",
        }
      );
      if (!Array.isArray(projectMembersFormatJson) && !isRecord(projectMembersFormatJson)) {
        fail("org project-members --format json verification failed: invalid response shape");
      }
      const projectMembersFormatTsvOutput = runChecked(
        ["node", cliPath, "org", "project-members", "--org", organizationId, "--project", projectId, "--format", "tsv"],
        {
          cwd: projectRoot,
          env,
          step: "org.project-members.format.tsv",
        }
      ).stdout.trim();
      if (!projectMembersFormatTsvOutput) {
        fail("org project-members --format tsv verification failed: empty output");
      }
      const projectMembersOutPath = path.join(tmpRoot, `org-project-members-${runId}.tsv`);
      runChecked(
        [
          "node",
          cliPath,
          "org",
          "project-members",
          "--org",
          organizationId,
          "--project",
          projectId,
          "--format",
          "tsv",
          "--out",
          projectMembersOutPath,
        ],
        {
          cwd: projectRoot,
          env,
          step: "org.project-members.out.tsv",
        }
      );
      if (!fs.existsSync(projectMembersOutPath)) {
        fail("org project-members --out verification failed: output file not found");
      }
      runExpectedFailure(
        ["node", cliPath, "org", "project-members", "--org", organizationId, "--project", projectId, "--format", "bad"],
        {
          cwd: projectRoot,
          env,
          step: "org.project-members.format.invalid",
          contains: "Invalid --format value",
        }
      );
      runExpectedFailure(
        [
          "node",
          cliPath,
          "org",
          "project-members",
          "--org",
          organizationId,
          "--project",
          projectId,
          "--format",
          "table",
          "--out",
          path.join(tmpRoot, `org-project-members-invalid-out-${runId}.txt`),
        ],
        {
          cwd: projectRoot,
          env,
          step: "org.project-members.out.table.invalid",
          contains: "--out` requires --format tsv/json",
        }
      );

      const projectMemberAddFormatJson = runJson(
        [
          "org",
          "project-member-add",
          "--org",
          organizationId,
          "--project",
          projectId,
          "--user",
          currentUserId,
          "--role",
          "project.participant",
          "--format",
          "json",
        ],
        {
          step: "org.project-member-add.format.json",
        }
      );
      if (!isRecord(projectMemberAddFormatJson)) {
        fail("org project-member-add --format json verification failed: invalid response shape");
      }
      runJson(
        [
          "org",
          "project-member-remove",
          "--org",
          organizationId,
          "--project",
          projectId,
          "--user",
          currentUserId,
          "--role",
          "project.participant",
          "--yes",
          "--json",
        ],
        {
          step: "org.project-member-add.format.json.cleanup",
        }
      );

      const projectMemberAddFormatTsvOutput = runChecked(
        [
          "node",
          cliPath,
          "org",
          "project-member-add",
          "--org",
          organizationId,
          "--project",
          projectId,
          "--user",
          currentUserId,
          "--role",
          "project.participant",
          "--format",
          "tsv",
        ],
        {
          cwd: projectRoot,
          env,
          step: "org.project-member-add.format.tsv",
        }
      ).stdout.trim();
      if (!projectMemberAddFormatTsvOutput.includes("key\tvalue")) {
        fail("org project-member-add --format tsv verification failed: missing tsv header");
      }
      runJson(
        [
          "org",
          "project-member-remove",
          "--org",
          organizationId,
          "--project",
          projectId,
          "--user",
          currentUserId,
          "--role",
          "project.participant",
          "--yes",
          "--json",
        ],
        {
          step: "org.project-member-add.format.tsv.cleanup",
        }
      );

      const projectMemberAddOutPath = path.join(tmpRoot, `org-project-member-add-${runId}.tsv`);
      runChecked(
        [
          "node",
          cliPath,
          "org",
          "project-member-add",
          "--org",
          organizationId,
          "--project",
          projectId,
          "--user",
          currentUserId,
          "--role",
          "project.participant",
          "--format",
          "tsv",
          "--out",
          projectMemberAddOutPath,
        ],
        {
          cwd: projectRoot,
          env,
          step: "org.project-member-add.out.tsv",
        }
      );
      if (!fs.existsSync(projectMemberAddOutPath)) {
        fail("org project-member-add --out verification failed: output file not found");
      }
      const projectMemberAddOutText = fs.readFileSync(projectMemberAddOutPath, "utf-8");
      if (!projectMemberAddOutText.includes("key\tvalue")) {
        fail("org project-member-add --out verification failed: missing tsv header");
      }
      runJson(
        [
          "org",
          "project-member-remove",
          "--org",
          organizationId,
          "--project",
          projectId,
          "--user",
          currentUserId,
          "--role",
          "project.participant",
          "--yes",
          "--json",
        ],
        {
          step: "org.project-member-add.out.tsv.cleanup",
        }
      );

      runExpectedFailure(
        [
          "node",
          cliPath,
          "org",
          "project-member-add",
          "--org",
          organizationId,
          "--project",
          projectId,
          "--user",
          currentUserId,
          "--role",
          "project.participant",
          "--format",
          "bad",
        ],
        {
          cwd: projectRoot,
          env,
          step: "org.project-member-add.format.invalid",
          contains: "Invalid --format value",
        }
      );
      runExpectedFailure(
        [
          "node",
          cliPath,
          "org",
          "project-member-add",
          "--org",
          organizationId,
          "--project",
          projectId,
          "--user",
          currentUserId,
          "--role",
          "project.participant",
          "--format",
          "table",
          "--out",
          path.join(tmpRoot, `org-project-member-add-invalid-out-${runId}.txt`),
        ],
        {
          cwd: projectRoot,
          env,
          step: "org.project-member-add.out.table.invalid",
          contains: "--out` requires --format tsv/json",
        }
      );

      runJson(
        [
          "org",
          "project-member-add",
          "--org",
          organizationId,
          "--project",
          projectId,
          "--user",
          currentUserId,
          "--role",
          "project.participant",
          "--json",
        ],
        {
          step: "org.project-member-remove.format.json.seed",
        }
      );
      const projectMemberRemoveFormatJson = runJson(
        [
          "org",
          "project-member-remove",
          "--org",
          organizationId,
          "--project",
          projectId,
          "--user",
          currentUserId,
          "--role",
          "project.participant",
          "--yes",
          "--format",
          "json",
        ],
        {
          step: "org.project-member-remove.format.json",
        }
      );
      if (!isRecord(projectMemberRemoveFormatJson)) {
        fail("org project-member-remove --format json verification failed: invalid response shape");
      }

      runJson(
        [
          "org",
          "project-member-add",
          "--org",
          organizationId,
          "--project",
          projectId,
          "--user",
          currentUserId,
          "--role",
          "project.participant",
          "--json",
        ],
        {
          step: "org.project-member-remove.format.tsv.seed",
        }
      );
      const projectMemberRemoveFormatTsvOutput = runChecked(
        [
          "node",
          cliPath,
          "org",
          "project-member-remove",
          "--org",
          organizationId,
          "--project",
          projectId,
          "--user",
          currentUserId,
          "--role",
          "project.participant",
          "--yes",
          "--format",
          "tsv",
        ],
        {
          cwd: projectRoot,
          env,
          step: "org.project-member-remove.format.tsv",
        }
      ).stdout.trim();
      if (!projectMemberRemoveFormatTsvOutput.includes("key\tvalue")) {
        fail("org project-member-remove --format tsv verification failed: missing tsv header");
      }

      runJson(
        [
          "org",
          "project-member-add",
          "--org",
          organizationId,
          "--project",
          projectId,
          "--user",
          currentUserId,
          "--role",
          "project.participant",
          "--json",
        ],
        {
          step: "org.project-member-remove.out.tsv.seed",
        }
      );
      const projectMemberRemoveOutPath = path.join(tmpRoot, `org-project-member-remove-${runId}.tsv`);
      runChecked(
        [
          "node",
          cliPath,
          "org",
          "project-member-remove",
          "--org",
          organizationId,
          "--project",
          projectId,
          "--user",
          currentUserId,
          "--role",
          "project.participant",
          "--yes",
          "--format",
          "tsv",
          "--out",
          projectMemberRemoveOutPath,
        ],
        {
          cwd: projectRoot,
          env,
          step: "org.project-member-remove.out.tsv",
        }
      );
      if (!fs.existsSync(projectMemberRemoveOutPath)) {
        fail("org project-member-remove --out verification failed: output file not found");
      }
      const projectMemberRemoveOutText = fs.readFileSync(projectMemberRemoveOutPath, "utf-8");
      if (!projectMemberRemoveOutText.includes("key\tvalue")) {
        fail("org project-member-remove --out verification failed: missing tsv header");
      }
      runExpectedFailure(
        [
          "node",
          cliPath,
          "org",
          "project-member-remove",
          "--org",
          organizationId,
          "--project",
          projectId,
          "--user",
          currentUserId,
          "--role",
          "project.participant",
          "--yes",
          "--format",
          "bad",
        ],
        {
          cwd: projectRoot,
          env,
          step: "org.project-member-remove.format.invalid",
          contains: "Invalid --format value",
        }
      );
      runExpectedFailure(
        [
          "node",
          cliPath,
          "org",
          "project-member-remove",
          "--org",
          organizationId,
          "--project",
          projectId,
          "--user",
          currentUserId,
          "--role",
          "project.participant",
          "--yes",
          "--format",
          "table",
          "--out",
          path.join(tmpRoot, `org-project-member-remove-invalid-out-${runId}.txt`),
        ],
        {
          cwd: projectRoot,
          env,
          step: "org.project-member-remove.out.table.invalid",
          contains: "--out` requires --format tsv/json",
        }
      );

      note("org.project-member", "members/add/remove/add-format/add-out/remove-format/remove-out");
    } catch (error) {
      for (let i = projectMemberSoftFrom; i < structuredStepReport.length; i += 1) {
        const item = structuredStepReport[i];
        if (item && item.step && String(item.step).startsWith("org.project-member") && item.status === "FAIL") {
          item.status = "SOFT_FAIL";
        }
      }
      warnings.push(
        `org project-member tests skipped: ${sanitizeText(error instanceof Error ? error.message : String(error))}`
      );
    }

    const createdIssue = runJson(
      [
        "issue",
        "create",
        "--org",
        organizationId,
        "--project",
        projectId,
        "--title",
        "e2e smoke issue",
        "--body",
        "created by scripts/e2e-smoke.mjs",
        "--json",
      ],
      { step: "issue.create" }
    );
    issueId = readFirstString(createdIssue, ["id", "identifier", "result.id", "result.identifier"]);
    if (!issueId) {
      fail("issue create returned no issue id");
    }
    note("issue.create", issueId);

    const issueListFormatJson = runJson(
      ["issue", "list", "--org", organizationId, "--project", projectId, "--limit", "20", "--format", "json"],
      {
        step: "issue.list.format.json",
      }
    );
    if (!Array.isArray(issueListFormatJson) && !isRecord(issueListFormatJson)) {
      fail("issue list --format json verification failed: invalid response shape");
    }
    const issueListFormatTsvOutput = runChecked(
      ["node", cliPath, "issue", "list", "--org", organizationId, "--project", projectId, "--limit", "20", "--format", "tsv"],
      {
        cwd: projectRoot,
        env,
        step: "issue.list.format.tsv",
      }
    ).stdout.trim();
    if (!issueListFormatTsvOutput.includes("id\tidentifier\tsubject\tstatus\tassignee\tcreator\tcreatedAt\tupdatedAt")) {
      fail("issue list --format tsv verification failed: missing tsv header");
    }
    const issueListOutPath = path.join(tmpRoot, `issue-list-${runId}.tsv`);
    runChecked(
      [
        "node",
        cliPath,
        "issue",
        "list",
        "--org",
        organizationId,
        "--project",
        projectId,
        "--limit",
        "20",
        "--format",
        "tsv",
        "--out",
        issueListOutPath,
      ],
      {
        cwd: projectRoot,
        env,
        step: "issue.list.out.tsv",
      }
    );
    if (!fs.existsSync(issueListOutPath)) {
      fail("issue list --out verification failed: output file not found");
    }
    const issueListOutText = fs.readFileSync(issueListOutPath, "utf-8");
    if (!issueListOutText.includes("id\tidentifier\tsubject\tstatus\tassignee\tcreator\tcreatedAt\tupdatedAt")) {
      fail("issue list --out verification failed: missing tsv header");
    }
    runExpectedFailure(
      ["node", cliPath, "issue", "list", "--org", organizationId, "--project", projectId, "--limit", "20", "--format", "bad"],
      {
        cwd: projectRoot,
        env,
        step: "issue.list.format.invalid",
        contains: "Invalid --format value",
      }
    );
    runExpectedFailure(
      [
        "node",
        cliPath,
        "issue",
        "list",
        "--org",
        organizationId,
        "--project",
        projectId,
        "--limit",
        "20",
        "--format",
        "table",
        "--out",
        path.join(tmpRoot, `issue-list-invalid-out-${runId}.txt`),
      ],
      {
        cwd: projectRoot,
        env,
        step: "issue.list.out.table.invalid",
        contains: "--out` requires --format tsv/json",
      }
    );

    const issueCreateFormatJson = runJson(
      [
        "issue",
        "create",
        "--org",
        organizationId,
        "--project",
        projectId,
        "--title",
        `e2e smoke issue create format json ${runId}`,
        "--body",
        "created by smoke for issue create format json",
        "--format",
        "json",
      ],
      { step: "issue.create.format.json" }
    );
    const issueCreateFormatJsonId = readFirstString(issueCreateFormatJson, ["id", "identifier", "result.id", "result.identifier"]);
    if (!issueCreateFormatJsonId) {
      fail("issue create --format json returned no issue id");
    }
    runJson(["issue", "delete", issueCreateFormatJsonId, "--org", organizationId, "--yes", "--json"], {
      step: "issue.create.format.json.cleanup",
    });

    const issueCreateFormatTsvOutput = runChecked(
      [
        "node",
        cliPath,
        "issue",
        "create",
        "--org",
        organizationId,
        "--project",
        projectId,
        "--title",
        `e2e smoke issue create format tsv ${runId}`,
        "--body",
        "created by smoke for issue create format tsv",
        "--format",
        "tsv",
      ],
      {
        cwd: projectRoot,
        env,
        step: "issue.create.format.tsv",
      }
    ).stdout.trim();
    if (!issueCreateFormatTsvOutput.includes("key\tvalue")) {
      fail("issue create --format tsv verification failed: missing tsv header");
    }
    const issueCreateFormatTsvId =
      readTsvValue(issueCreateFormatTsvOutput, "id") ?? readTsvValue(issueCreateFormatTsvOutput, "identifier");
    if (!issueCreateFormatTsvId) {
      fail("issue create --format tsv verification failed: cannot resolve issue id from output");
    }
    runJson(["issue", "delete", issueCreateFormatTsvId, "--org", organizationId, "--yes", "--json"], {
      step: "issue.create.format.tsv.cleanup",
    });

    const issueCreateOutPath = path.join(tmpRoot, `issue-create-${runId}.tsv`);
    runChecked(
      [
        "node",
        cliPath,
        "issue",
        "create",
        "--org",
        organizationId,
        "--project",
        projectId,
        "--title",
        `e2e smoke issue create out ${runId}`,
        "--body",
        "created by smoke for issue create out",
        "--format",
        "tsv",
        "--out",
        issueCreateOutPath,
      ],
      {
        cwd: projectRoot,
        env,
        step: "issue.create.out.tsv",
      }
    );
    if (!fs.existsSync(issueCreateOutPath)) {
      fail("issue create --out verification failed: output file not found");
    }
    const issueCreateOutText = fs.readFileSync(issueCreateOutPath, "utf-8");
    if (!issueCreateOutText.includes("key\tvalue")) {
      fail("issue create --out verification failed: missing tsv header");
    }
    const issueCreateOutId =
      readTsvValue(issueCreateOutText, "id") ?? readTsvValue(issueCreateOutText, "identifier");
    if (!issueCreateOutId) {
      fail("issue create --out verification failed: cannot resolve issue id from output");
    }
    runJson(["issue", "delete", issueCreateOutId, "--org", organizationId, "--yes", "--json"], {
      step: "issue.create.out.cleanup",
    });
    runExpectedFailure(
      [
        "node",
        cliPath,
        "issue",
        "create",
        "--org",
        organizationId,
        "--project",
        projectId,
        "--title",
        `e2e smoke issue create invalid format ${runId}`,
        "--body",
        "invalid format verification",
        "--format",
        "bad",
      ],
      {
        cwd: projectRoot,
        env,
        step: "issue.create.format.invalid",
        contains: "Invalid --format value",
      }
    );
    runExpectedFailure(
      [
        "node",
        cliPath,
        "issue",
        "create",
        "--org",
        organizationId,
        "--project",
        projectId,
        "--title",
        `e2e smoke issue create invalid out ${runId}`,
        "--body",
        "invalid out verification",
        "--format",
        "table",
        "--out",
        path.join(tmpRoot, `issue-create-invalid-out-${runId}.txt`),
      ],
      {
        cwd: projectRoot,
        env,
        step: "issue.create.out.table.invalid",
        contains: "--out` requires --format tsv/json",
      }
    );

    const workitemSoftFrom = structuredStepReport.length;
    try {
      const workitemList = runJson(
        ["workitem", "list", "--org", organizationId, "--project", projectId, "--category", "Req", "--per-page", "20", "--json"],
        {
          step: "workitem.list",
        }
      );
      if (!isRecord(workitemList) && !Array.isArray(workitemList)) {
        fail("workitem list --json verification failed: invalid response shape");
      }
      const workitemListFormatJson = runJson(
        [
          "workitem",
          "list",
          "--org",
          organizationId,
          "--project",
          projectId,
          "--category",
          "Req",
          "--per-page",
          "20",
          "--format",
          "json",
        ],
        {
          step: "workitem.list.format.json",
        }
      );
      if (!isRecord(workitemListFormatJson) && !Array.isArray(workitemListFormatJson)) {
        fail("workitem list --format json verification failed: invalid response shape");
      }
      const workitemListFormatTsvOutput = runChecked(
        [
          "node",
          cliPath,
          "workitem",
          "list",
          "--org",
          organizationId,
          "--project",
          projectId,
          "--category",
          "Req",
          "--per-page",
          "20",
          "--format",
          "tsv",
        ],
        {
          cwd: projectRoot,
          env,
          step: "workitem.list.format.tsv",
        }
      ).stdout.trim();
      if (!workitemListFormatTsvOutput.includes("id\tidentifier\tsubject\tstatus\tassignedTo\tcreator\tpriority\tworkitemTypeId")) {
        fail("workitem list --format tsv verification failed: missing tsv header");
      }
      const workitemListOutPath = path.join(tmpRoot, `workitem-list-${runId}.tsv`);
      runChecked(
        [
          "node",
          cliPath,
          "workitem",
          "list",
          "--org",
          organizationId,
          "--project",
          projectId,
          "--category",
          "Req",
          "--per-page",
          "20",
          "--format",
          "tsv",
          "--out",
          workitemListOutPath,
        ],
        {
          cwd: projectRoot,
          env,
          step: "workitem.list.out.tsv",
        }
      );
      if (!fs.existsSync(workitemListOutPath)) {
        fail("workitem list --out verification failed: output file not found");
      }
      const workitemListOutText = fs.readFileSync(workitemListOutPath, "utf-8");
      if (!workitemListOutText.includes("id\tidentifier\tsubject\tstatus\tassignedTo\tcreator\tpriority\tworkitemTypeId")) {
        fail("workitem list --out verification failed: missing tsv header");
      }
      runExpectedFailure(
        [
          "node",
          cliPath,
          "workitem",
          "list",
          "--org",
          organizationId,
          "--project",
          projectId,
          "--format",
          "bad",
        ],
        {
          cwd: projectRoot,
          env,
          step: "workitem.list.format.invalid",
          contains: "Invalid --format value",
        }
      );
      runExpectedFailure(
        [
          "node",
          cliPath,
          "workitem",
          "list",
          "--org",
          organizationId,
          "--project",
          projectId,
          "--format",
          "table",
          "--out",
          path.join(tmpRoot, `workitem-list-invalid-out-${runId}.txt`),
        ],
        {
          cwd: projectRoot,
          env,
          step: "workitem.list.out.table.invalid",
          contains: "--out` requires --format tsv/json",
        }
      );

      runJson(["workitem", "view", issueId, "--org", organizationId, "--json"], {
        step: "workitem.view",
      });
      const workitemViewFormatJson = runJson(
        ["workitem", "view", issueId, "--org", organizationId, "--format", "json"],
        {
          step: "workitem.view.format.json",
        }
      );
      if (!isRecord(workitemViewFormatJson)) {
        fail("workitem view --format json verification failed: invalid response shape");
      }
      const workitemViewFormatTsvOutput = runChecked(
        ["node", cliPath, "workitem", "view", issueId, "--org", organizationId, "--format", "tsv"],
        {
          cwd: projectRoot,
          env,
          step: "workitem.view.format.tsv",
        }
      ).stdout.trim();
      if (!workitemViewFormatTsvOutput.includes("key\tvalue")) {
        fail("workitem view --format tsv verification failed: missing tsv header");
      }
      const workitemViewOutPath = path.join(tmpRoot, `workitem-view-${runId}.tsv`);
      runChecked(
        [
          "node",
          cliPath,
          "workitem",
          "view",
          issueId,
          "--org",
          organizationId,
          "--format",
          "tsv",
          "--out",
          workitemViewOutPath,
        ],
        {
          cwd: projectRoot,
          env,
          step: "workitem.view.out.tsv",
        }
      );
      if (!fs.existsSync(workitemViewOutPath)) {
        fail("workitem view --out verification failed: output file not found");
      }
      const workitemViewOutText = fs.readFileSync(workitemViewOutPath, "utf-8");
      if (!workitemViewOutText.includes("key\tvalue")) {
        fail("workitem view --out verification failed: missing tsv header");
      }
      runExpectedFailure(
        ["node", cliPath, "workitem", "view", issueId, "--org", organizationId, "--format", "bad"],
        {
          cwd: projectRoot,
          env,
          step: "workitem.view.format.invalid",
          contains: "Invalid --format value",
        }
      );
      runExpectedFailure(
        [
          "node",
          cliPath,
          "workitem",
          "view",
          issueId,
          "--org",
          organizationId,
          "--format",
          "table",
          "--out",
          path.join(tmpRoot, `workitem-view-invalid-out-${runId}.txt`),
        ],
        {
          cwd: projectRoot,
          env,
          step: "workitem.view.out.table.invalid",
          contains: "--out` requires --format tsv/json",
        }
      );

      runJson(
        ["workitem", "update", issueId, "--org", organizationId, "--subject", `e2e workitem updated ${runId}`, "--format", "json"],
        {
          step: "workitem.update",
        }
      );
      const workitemUpdateFormatTsvOutput = runChecked(
        [
          "node",
          cliPath,
          "workitem",
          "update",
          issueId,
          "--org",
          organizationId,
          "--subject",
          `e2e workitem updated tsv ${runId}`,
          "--format",
          "tsv",
        ],
        {
          cwd: projectRoot,
          env,
          step: "workitem.update.format.tsv",
        }
      ).stdout.trim();
      if (!workitemUpdateFormatTsvOutput.includes("key\tvalue")) {
        fail("workitem update --format tsv verification failed: missing tsv header");
      }
      const workitemUpdateOutPath = path.join(tmpRoot, `workitem-update-${runId}.tsv`);
      runChecked(
        [
          "node",
          cliPath,
          "workitem",
          "update",
          issueId,
          "--org",
          organizationId,
          "--subject",
          `e2e workitem updated out ${runId}`,
          "--format",
          "tsv",
          "--out",
          workitemUpdateOutPath,
        ],
        {
          cwd: projectRoot,
          env,
          step: "workitem.update.out.tsv",
        }
      );
      if (!fs.existsSync(workitemUpdateOutPath)) {
        fail("workitem update --out verification failed: output file not found");
      }
      const workitemUpdateOutText = fs.readFileSync(workitemUpdateOutPath, "utf-8");
      if (!workitemUpdateOutText.includes("key\tvalue")) {
        fail("workitem update --out verification failed: missing tsv header");
      }
      runExpectedFailure(
        [
          "node",
          cliPath,
          "workitem",
          "update",
          issueId,
          "--org",
          organizationId,
          "--subject",
          `e2e workitem updated invalid ${runId}`,
          "--format",
          "bad",
        ],
        {
          cwd: projectRoot,
          env,
          step: "workitem.update.format.invalid",
          contains: "Invalid --format value",
        }
      );
      runExpectedFailure(
        [
          "node",
          cliPath,
          "workitem",
          "update",
          issueId,
          "--org",
          organizationId,
          "--subject",
          `e2e workitem updated invalid out ${runId}`,
          "--format",
          "table",
          "--out",
          path.join(tmpRoot, `workitem-update-invalid-out-${runId}.txt`),
        ],
        {
          cwd: projectRoot,
          env,
          step: "workitem.update.out.table.invalid",
          contains: "--out` requires --format tsv/json",
        }
      );

      const workitemCommentResult = runJson(
        ["workitem", "comment", issueId, "--org", organizationId, "--content", `workitem e2e comment ${runId}`, "--json"],
        {
          step: "workitem.comment",
        }
      );
      if (!isRecord(workitemCommentResult)) {
        fail("workitem comment --json verification failed: invalid response shape");
      }
      let workitemCommentId = readFirstString(workitemCommentResult, [
        "id",
        "commentId",
        "identifier",
        "result.id",
        "result.commentId",
        "result.identifier",
      ]);
      const workitemCommentFormatTsvOutput = runChecked(
        [
          "node",
          cliPath,
          "workitem",
          "comment",
          issueId,
          "--org",
          organizationId,
          "--content",
          `workitem e2e comment tsv ${runId}`,
          "--format",
          "tsv",
        ],
        {
          cwd: projectRoot,
          env,
          step: "workitem.comment.format.tsv",
        }
      ).stdout.trim();
      if (!workitemCommentFormatTsvOutput.includes("key\tvalue")) {
        fail("workitem comment --format tsv verification failed: missing tsv header");
      }
      const workitemCommentOutPath = path.join(tmpRoot, `workitem-comment-${runId}.tsv`);
      runChecked(
        [
          "node",
          cliPath,
          "workitem",
          "comment",
          issueId,
          "--org",
          organizationId,
          "--content",
          `workitem e2e comment out ${runId}`,
          "--format",
          "tsv",
          "--out",
          workitemCommentOutPath,
        ],
        {
          cwd: projectRoot,
          env,
          step: "workitem.comment.out.tsv",
        }
      );
      if (!fs.existsSync(workitemCommentOutPath)) {
        fail("workitem comment --out verification failed: output file not found");
      }
      const workitemCommentOutText = fs.readFileSync(workitemCommentOutPath, "utf-8");
      if (!workitemCommentOutText.includes("key\tvalue")) {
        fail("workitem comment --out verification failed: missing tsv header");
      }
      runExpectedFailure(
        [
          "node",
          cliPath,
          "workitem",
          "comment",
          issueId,
          "--org",
          organizationId,
          "--content",
          `workitem e2e comment invalid ${runId}`,
          "--format",
          "bad",
        ],
        {
          cwd: projectRoot,
          env,
          step: "workitem.comment.format.invalid",
          contains: "Invalid --format value",
        }
      );
      runExpectedFailure(
        [
          "node",
          cliPath,
          "workitem",
          "comment",
          issueId,
          "--org",
          organizationId,
          "--content",
          `workitem e2e comment invalid out ${runId}`,
          "--format",
          "table",
          "--out",
          path.join(tmpRoot, `workitem-comment-invalid-out-${runId}.txt`),
        ],
        {
          cwd: projectRoot,
          env,
          step: "workitem.comment.out.table.invalid",
          contains: "--out` requires --format tsv/json",
        }
      );

      const workitemComments = runJson(["workitem", "comments", issueId, "--org", organizationId, "--json"], {
        step: "workitem.comments",
      });
      if (!isRecord(workitemComments) && !Array.isArray(workitemComments)) {
        fail("workitem comments --json verification failed: invalid response shape");
      }
      const workitemCommentsFormatJson = runJson(
        ["workitem", "comments", issueId, "--org", organizationId, "--format", "json"],
        {
          step: "workitem.comments.format.json",
        }
      );
      if (!isRecord(workitemCommentsFormatJson) && !Array.isArray(workitemCommentsFormatJson)) {
        fail("workitem comments --format json verification failed: invalid response shape");
      }
      const workitemCommentsFormatTsvOutput = runChecked(
        ["node", cliPath, "workitem", "comments", issueId, "--org", organizationId, "--format", "tsv"],
        {
          cwd: projectRoot,
          env,
          step: "workitem.comments.format.tsv",
        }
      ).stdout.trim();
      if (!workitemCommentsFormatTsvOutput.includes("id\tcommentId\tcontent\tcreator\tcreatedAt\tupdatedAt")) {
        fail("workitem comments --format tsv verification failed: missing tsv header");
      }
      const workitemCommentsOutPath = path.join(tmpRoot, `workitem-comments-${runId}.tsv`);
      runChecked(
        [
          "node",
          cliPath,
          "workitem",
          "comments",
          issueId,
          "--org",
          organizationId,
          "--format",
          "tsv",
          "--out",
          workitemCommentsOutPath,
        ],
        {
          cwd: projectRoot,
          env,
          step: "workitem.comments.out.tsv",
        }
      );
      if (!fs.existsSync(workitemCommentsOutPath)) {
        fail("workitem comments --out verification failed: output file not found");
      }
      const workitemCommentsOutText = fs.readFileSync(workitemCommentsOutPath, "utf-8");
      if (!workitemCommentsOutText.includes("id\tcommentId\tcontent\tcreator\tcreatedAt\tupdatedAt")) {
        fail("workitem comments --out verification failed: missing tsv header");
      }
      runExpectedFailure(
        ["node", cliPath, "workitem", "comments", issueId, "--org", organizationId, "--format", "bad"],
        {
          cwd: projectRoot,
          env,
          step: "workitem.comments.format.invalid",
          contains: "Invalid --format value",
        }
      );
      runExpectedFailure(
        [
          "node",
          cliPath,
          "workitem",
          "comments",
          issueId,
          "--org",
          organizationId,
          "--format",
          "table",
          "--out",
          path.join(tmpRoot, `workitem-comments-invalid-out-${runId}.txt`),
        ],
        {
          cwd: projectRoot,
          env,
          step: "workitem.comments.out.table.invalid",
          contains: "--out` requires --format tsv/json",
        }
      );
      if (!workitemCommentId) {
        workitemCommentId = findWorkitemCommentId(workitemComments, `workitem e2e comment ${runId}`);
      }
      if (workitemCommentId) {
        runExpectedFailure(
          [
            "node",
            cliPath,
            "workitem",
            "comment-edit",
            issueId,
            workitemCommentId,
            "--org",
            organizationId,
            "--content",
            "x",
            "--format",
            "bad",
          ],
          {
            cwd: projectRoot,
            env,
            step: "workitem.comment-edit.format.invalid",
            contains: "Invalid --format value",
          }
        );
        runExpectedFailure(
          [
            "node",
            cliPath,
            "workitem",
            "comment-edit",
            issueId,
            workitemCommentId,
            "--org",
            organizationId,
            "--content",
            "x",
            "--format",
            "table",
            "--out",
            path.join(tmpRoot, `workitem-comment-edit-invalid-out-${runId}.txt`),
          ],
          {
            cwd: projectRoot,
            env,
            step: "workitem.comment-edit.out.table.invalid",
            contains: "--out` requires --format tsv/json",
          }
        );
        runSoft(
          [
            "workitem",
            "comment-edit",
            issueId,
            workitemCommentId,
            "--org",
            organizationId,
            "--content",
            `workitem e2e comment edited ${runId}`,
            "--format",
            "json",
          ],
          "workitem.comment-edit.format.json",
          warnings
        );

        runExpectedFailure(
          [
            "node",
            cliPath,
            "workitem",
            "comment-delete",
            issueId,
            workitemCommentId,
            "--org",
            organizationId,
            "--yes",
            "--format",
            "bad",
          ],
          {
            cwd: projectRoot,
            env,
            step: "workitem.comment-delete.format.invalid",
            contains: "Invalid --format value",
          }
        );
        runExpectedFailure(
          [
            "node",
            cliPath,
            "workitem",
            "comment-delete",
            issueId,
            workitemCommentId,
            "--org",
            organizationId,
            "--yes",
            "--format",
            "table",
            "--out",
            path.join(tmpRoot, `workitem-comment-delete-invalid-out-${runId}.txt`),
          ],
          {
            cwd: projectRoot,
            env,
            step: "workitem.comment-delete.out.table.invalid",
            contains: "--out` requires --format tsv/json",
          }
        );
        runSoft(
          ["workitem", "comment-delete", issueId, workitemCommentId, "--org", organizationId, "--yes", "--format", "json"],
          "workitem.comment-delete.format.json",
          warnings
        );
      } else {
        warnings.push("workitem comment edit/delete skipped: cannot resolve comment id from API response.");
      }
      note(
        "workitem",
        "list/list-format/list-out/view/view-format/view-out/update/update-format/update-out/comments/comments-format/comments-out/comment/comment-format/comment-out/comment-edit/comment-edit-format/comment-edit-out/comment-delete/comment-delete-format/comment-delete-out"
      );
    } catch (error) {
      for (let i = workitemSoftFrom; i < structuredStepReport.length; i += 1) {
        const item = structuredStepReport[i];
        if (item && item.step && String(item.step).startsWith("workitem.") && item.status === "FAIL") {
          item.status = "SOFT_FAIL";
        }
      }
      warnings.push(`workitem tests skipped: ${sanitizeText(error instanceof Error ? error.message : String(error))}`);
    }

    const issueViewFormatJson = runJson(["issue", "view", issueId, "--org", organizationId, "--format", "json"], {
      step: "issue.view.format.json",
    });
    if (!isRecord(issueViewFormatJson)) {
      fail("issue view --format json verification failed: invalid response shape");
    }
    const issueViewFormatTsvOutput = runChecked(
      ["node", cliPath, "issue", "view", issueId, "--org", organizationId, "--format", "tsv"],
      {
        cwd: projectRoot,
        env,
        step: "issue.view.format.tsv",
      }
    ).stdout.trim();
    if (!issueViewFormatTsvOutput.includes("key\tvalue")) {
      fail("issue view --format tsv verification failed: missing tsv header");
    }
    const issueViewOutPath = path.join(tmpRoot, `issue-view-${runId}.tsv`);
    runChecked(
      ["node", cliPath, "issue", "view", issueId, "--org", organizationId, "--format", "tsv", "--out", issueViewOutPath],
      {
        cwd: projectRoot,
        env,
        step: "issue.view.out.tsv",
      }
    );
    if (!fs.existsSync(issueViewOutPath)) {
      fail("issue view --out verification failed: output file not found");
    }
    const issueViewOutText = fs.readFileSync(issueViewOutPath, "utf-8");
    if (!issueViewOutText.includes("key\tvalue")) {
      fail("issue view --out verification failed: missing tsv header");
    }
    runExpectedFailure(
      ["node", cliPath, "issue", "view", issueId, "--org", organizationId, "--format", "bad"],
      {
        cwd: projectRoot,
        env,
        step: "issue.view.format.invalid",
        contains: "Invalid --format value",
      }
    );
    runExpectedFailure(
      [
        "node",
        cliPath,
        "issue",
        "view",
        issueId,
        "--org",
        organizationId,
        "--format",
        "table",
        "--out",
        path.join(tmpRoot, `issue-view-invalid-out-${runId}.txt`),
      ],
      {
        cwd: projectRoot,
        env,
        step: "issue.view.out.table.invalid",
        contains: "--out` requires --format tsv/json",
      }
    );
    const issueStatusFormatJson = runJson(["issue", "status", "--org", organizationId, "--project", projectId, "--format", "json"], {
      step: "issue.status.format.json",
    });
    if (!isRecord(issueStatusFormatJson)) {
      fail("issue status --format json verification failed: invalid response shape");
    }
    const issueStatusFormatTsvOutput = runChecked(
      ["node", cliPath, "issue", "status", "--org", organizationId, "--project", projectId, "--format", "tsv"],
      {
        cwd: projectRoot,
        env,
        step: "issue.status.format.tsv",
      }
    ).stdout.trim();
    if (!issueStatusFormatTsvOutput.includes("key\tvalue")) {
      fail("issue status --format tsv verification failed: missing tsv header");
    }
    const issueStatusOutPath = path.join(tmpRoot, `issue-status-${runId}.tsv`);
    runChecked(
      [
        "node",
        cliPath,
        "issue",
        "status",
        "--org",
        organizationId,
        "--project",
        projectId,
        "--format",
        "tsv",
        "--out",
        issueStatusOutPath,
      ],
      {
        cwd: projectRoot,
        env,
        step: "issue.status.out.tsv",
      }
    );
    if (!fs.existsSync(issueStatusOutPath)) {
      fail("issue status --out verification failed: output file not found");
    }
    const issueStatusOutText = fs.readFileSync(issueStatusOutPath, "utf-8");
    if (!issueStatusOutText.includes("key\tvalue")) {
      fail("issue status --out verification failed: missing tsv header");
    }
    runExpectedFailure(
      ["node", cliPath, "issue", "status", "--org", organizationId, "--project", projectId, "--format", "bad"],
      {
        cwd: projectRoot,
        env,
        step: "issue.status.format.invalid",
        contains: "Invalid --format value",
      }
    );
    runExpectedFailure(
      [
        "node",
        cliPath,
        "issue",
        "status",
        "--org",
        organizationId,
        "--project",
        projectId,
        "--format",
        "table",
        "--out",
        path.join(tmpRoot, `issue-status-invalid-out-${runId}.txt`),
      ],
      {
        cwd: projectRoot,
        env,
        step: "issue.status.out.table.invalid",
        contains: "--out` requires --format tsv/json",
      }
    );

    const issueActivitiesFormatJson = runJson(["issue", "activities", issueId, "--org", organizationId, "--format", "json"], {
      step: "issue.activities.format.json",
    });
    if (!Array.isArray(issueActivitiesFormatJson) && !isRecord(issueActivitiesFormatJson)) {
      fail("issue activities --format json verification failed: invalid response shape");
    }
    const issueActivitiesFormatTsvOutput = runChecked(
      ["node", cliPath, "issue", "activities", issueId, "--org", organizationId, "--format", "tsv"],
      {
        cwd: projectRoot,
        env,
        step: "issue.activities.format.tsv",
      }
    ).stdout.trim();
    if (!issueActivitiesFormatTsvOutput.includes("key\tvalue")) {
      fail("issue activities --format tsv verification failed: missing tsv header");
    }
    const issueActivitiesOutPath = path.join(tmpRoot, `issue-activities-${runId}.tsv`);
    runChecked(
      [
        "node",
        cliPath,
        "issue",
        "activities",
        issueId,
        "--org",
        organizationId,
        "--format",
        "tsv",
        "--out",
        issueActivitiesOutPath,
      ],
      {
        cwd: projectRoot,
        env,
        step: "issue.activities.out.tsv",
      }
    );
    if (!fs.existsSync(issueActivitiesOutPath)) {
      fail("issue activities --out verification failed: output file not found");
    }
    const issueActivitiesOutText = fs.readFileSync(issueActivitiesOutPath, "utf-8");
    if (!issueActivitiesOutText.includes("key\tvalue")) {
      fail("issue activities --out verification failed: missing tsv header");
    }
    runExpectedFailure(
      ["node", cliPath, "issue", "activities", issueId, "--org", organizationId, "--format", "bad"],
      {
        cwd: projectRoot,
        env,
        step: "issue.activities.format.invalid",
        contains: "Invalid --format value",
      }
    );
    runExpectedFailure(
      [
        "node",
        cliPath,
        "issue",
        "activities",
        issueId,
        "--org",
        organizationId,
        "--format",
        "table",
        "--out",
        path.join(tmpRoot, `issue-activities-invalid-out-${runId}.txt`),
      ],
      {
        cwd: projectRoot,
        env,
        step: "issue.activities.out.table.invalid",
        contains: "--out` requires --format tsv/json",
      }
    );

    const issueFieldsResult = runJson(["issue", "fields", issueId, "--org", organizationId, "--json"], {
      step: "issue.fields",
    });
    const issueFieldsFormatJson = runJson(["issue", "fields", issueId, "--org", organizationId, "--format", "json"], {
      step: "issue.fields.format.json",
    });
    if (!isRecord(issueFieldsFormatJson)) {
      fail("issue fields --format json verification failed: invalid response shape");
    }
    const issueFieldsFormatTsvOutput = runChecked(
      ["node", cliPath, "issue", "fields", issueId, "--org", organizationId, "--format", "tsv"],
      {
        cwd: projectRoot,
        env,
        step: "issue.fields.format.tsv",
      }
    ).stdout.trim();
    if (!issueFieldsFormatTsvOutput.includes("key\tvalue")) {
      fail("issue fields --format tsv verification failed: missing tsv header");
    }
    const issueFieldsOutPath = path.join(tmpRoot, `issue-fields-${runId}.tsv`);
    runChecked(
      [
        "node",
        cliPath,
        "issue",
        "fields",
        issueId,
        "--org",
        organizationId,
        "--format",
        "tsv",
        "--out",
        issueFieldsOutPath,
      ],
      {
        cwd: projectRoot,
        env,
        step: "issue.fields.out.tsv",
      }
    );
    if (!fs.existsSync(issueFieldsOutPath)) {
      fail("issue fields --out verification failed: output file not found");
    }
    const issueFieldsOutText = fs.readFileSync(issueFieldsOutPath, "utf-8");
    if (!issueFieldsOutText.includes("key\tvalue")) {
      fail("issue fields --out verification failed: missing tsv header");
    }
    runExpectedFailure(
      ["node", cliPath, "issue", "fields", issueId, "--org", organizationId, "--format", "bad"],
      {
        cwd: projectRoot,
        env,
        step: "issue.fields.format.invalid",
        contains: "Invalid --format value",
      }
    );
    runExpectedFailure(
      [
        "node",
        cliPath,
        "issue",
        "fields",
        issueId,
        "--org",
        organizationId,
        "--format",
        "table",
        "--out",
        path.join(tmpRoot, `issue-fields-invalid-out-${runId}.txt`),
      ],
      {
        cwd: projectRoot,
        env,
        step: "issue.fields.out.table.invalid",
        contains: "--out` requires --format tsv/json",
      }
    );

    const issueDevelopFormatJson = runJson(
      ["issue", "develop", issueId, "--org", organizationId, "--repo-dir", clonePath, "--dry-run", "--format", "json"],
      {
        step: "issue.develop.format.json",
      }
    );
    if (!isRecord(issueDevelopFormatJson)) {
      fail("issue develop --format json verification failed: invalid response shape");
    }
    const issueDevelopFormatTsvOutput = runChecked(
      ["node", cliPath, "issue", "develop", issueId, "--org", organizationId, "--repo-dir", clonePath, "--dry-run", "--format", "tsv"],
      {
        cwd: projectRoot,
        env,
        step: "issue.develop.format.tsv",
      }
    ).stdout.trim();
    if (!issueDevelopFormatTsvOutput.includes("key\tvalue")) {
      fail("issue develop --format tsv verification failed: missing tsv header");
    }
    const issueDevelopOutPath = path.join(tmpRoot, `issue-develop-${runId}.tsv`);
    runChecked(
      [
        "node",
        cliPath,
        "issue",
        "develop",
        issueId,
        "--org",
        organizationId,
        "--repo-dir",
        clonePath,
        "--dry-run",
        "--format",
        "tsv",
        "--out",
        issueDevelopOutPath,
      ],
      {
        cwd: projectRoot,
        env,
        step: "issue.develop.out.tsv",
      }
    );
    if (!fs.existsSync(issueDevelopOutPath)) {
      fail("issue develop --out verification failed: output file not found");
    }
    const issueDevelopOutText = fs.readFileSync(issueDevelopOutPath, "utf-8");
    if (!issueDevelopOutText.includes("key\tvalue")) {
      fail("issue develop --out verification failed: missing tsv header");
    }
    runExpectedFailure(
      ["node", cliPath, "issue", "develop", issueId, "--org", organizationId, "--repo-dir", clonePath, "--dry-run", "--format", "bad"],
      {
        cwd: projectRoot,
        env,
        step: "issue.develop.format.invalid",
        contains: "Invalid --format value",
      }
    );
    runExpectedFailure(
      [
        "node",
        cliPath,
        "issue",
        "develop",
        issueId,
        "--org",
        organizationId,
        "--repo-dir",
        clonePath,
        "--dry-run",
        "--format",
        "table",
        "--out",
        path.join(tmpRoot, `issue-develop-invalid-out-${runId}.txt`),
      ],
      {
        cwd: projectRoot,
        env,
        step: "issue.develop.out.table.invalid",
        contains: "--out` requires --format tsv/json",
      }
    );

    runSoft(
      ["issue", "transfer", issueId, "--org", organizationId, "--project", projectId, "--format", "json"],
      "issue.transfer.format.json",
      warnings
    );
    runExpectedFailure(
      ["node", cliPath, "issue", "transfer", issueId, "--org", organizationId, "--project", projectId, "--format", "bad"],
      {
        cwd: projectRoot,
        env,
        step: "issue.transfer.format.invalid",
        contains: "Invalid --format value",
      }
    );
    runExpectedFailure(
      [
        "node",
        cliPath,
        "issue",
        "transfer",
        issueId,
        "--org",
        organizationId,
        "--project",
        projectId,
        "--format",
        "table",
        "--out",
        path.join(tmpRoot, `issue-transfer-invalid-out-${runId}.txt`),
      ],
      {
        cwd: projectRoot,
        env,
        step: "issue.transfer.out.table.invalid",
        contains: "--out` requires --format tsv/json",
      }
    );

    const issueUpdateFormatJson = runJson(
      [
        "issue",
        "update",
        issueId,
        "--org",
        organizationId,
        "--title",
        `e2e smoke issue update ${runId}`,
        "--description",
        "updated by smoke script using update",
        "--format",
        "json",
      ],
      {
        step: "issue.update.format.json",
      }
    );
    if (issueUpdateFormatJson === null || issueUpdateFormatJson === undefined) {
      fail("issue update --format json verification failed: invalid response shape");
    }
    const issueUpdateFormatTsvOutput = runChecked(
      [
        "node",
        cliPath,
        "issue",
        "update",
        issueId,
        "--org",
        organizationId,
        "--title",
        `e2e smoke issue update tsv ${runId}`,
        "--description",
        "updated by smoke script using update tsv",
        "--format",
        "tsv",
      ],
      {
        cwd: projectRoot,
        env,
        step: "issue.update.format.tsv",
      }
    ).stdout.trim();
    if (!issueUpdateFormatTsvOutput.includes("key\tvalue")) {
      fail("issue update --format tsv verification failed: missing tsv header");
    }
    const issueUpdateOutPath = path.join(tmpRoot, `issue-update-${runId}.tsv`);
    runChecked(
      [
        "node",
        cliPath,
        "issue",
        "update",
        issueId,
        "--org",
        organizationId,
        "--title",
        `e2e smoke issue update out ${runId}`,
        "--description",
        "updated by smoke script using update out",
        "--format",
        "tsv",
        "--out",
        issueUpdateOutPath,
      ],
      {
        cwd: projectRoot,
        env,
        step: "issue.update.out.tsv",
      }
    );
    if (!fs.existsSync(issueUpdateOutPath)) {
      fail("issue update --out verification failed: output file not found");
    }
    const issueUpdateOutText = fs.readFileSync(issueUpdateOutPath, "utf-8");
    if (!issueUpdateOutText.includes("key\tvalue")) {
      fail("issue update --out verification failed: missing tsv header");
    }
    runExpectedFailure(
      ["node", cliPath, "issue", "update", issueId, "--org", organizationId, "--title", "x", "--format", "bad"],
      {
        cwd: projectRoot,
        env,
        step: "issue.update.format.invalid",
        contains: "Invalid --format value",
      }
    );
    runExpectedFailure(
      [
        "node",
        cliPath,
        "issue",
        "update",
        issueId,
        "--org",
        organizationId,
        "--title",
        "x",
        "--format",
        "table",
        "--out",
        path.join(tmpRoot, `issue-update-invalid-out-${runId}.txt`),
      ],
      {
        cwd: projectRoot,
        env,
        step: "issue.update.out.table.invalid",
        contains: "--out` requires --format tsv/json",
      }
    );

    const issueEditFormatJson = runJson(
      [
        "issue",
        "edit",
        issueId,
        "--org",
        organizationId,
        "--title",
        "e2e smoke issue (edited)",
        "--body",
        "edited by smoke script",
        "--format",
        "json",
      ],
      {
        step: "issue.edit.format.json",
      }
    );
    if (issueEditFormatJson === null || issueEditFormatJson === undefined) {
      fail("issue edit --format json verification failed: invalid response shape");
    }
    const issueEditFormatTsvOutput = runChecked(
      [
        "node",
        cliPath,
        "issue",
        "edit",
        issueId,
        "--org",
        organizationId,
        "--title",
        `e2e smoke issue edit tsv ${runId}`,
        "--body",
        "edited by smoke script using tsv",
        "--format",
        "tsv",
      ],
      {
        cwd: projectRoot,
        env,
        step: "issue.edit.format.tsv",
      }
    ).stdout.trim();
    if (!issueEditFormatTsvOutput.includes("key\tvalue")) {
      fail("issue edit --format tsv verification failed: missing tsv header");
    }
    const issueEditOutPath = path.join(tmpRoot, `issue-edit-${runId}.tsv`);
    runChecked(
      [
        "node",
        cliPath,
        "issue",
        "edit",
        issueId,
        "--org",
        organizationId,
        "--title",
        `e2e smoke issue edit out ${runId}`,
        "--body",
        "edited by smoke script using out",
        "--format",
        "tsv",
        "--out",
        issueEditOutPath,
      ],
      {
        cwd: projectRoot,
        env,
        step: "issue.edit.out.tsv",
      }
    );
    if (!fs.existsSync(issueEditOutPath)) {
      fail("issue edit --out verification failed: output file not found");
    }
    const issueEditOutText = fs.readFileSync(issueEditOutPath, "utf-8");
    if (!issueEditOutText.includes("key\tvalue")) {
      fail("issue edit --out verification failed: missing tsv header");
    }
    runExpectedFailure(
      ["node", cliPath, "issue", "edit", issueId, "--org", organizationId, "--title", "x", "--format", "bad"],
      {
        cwd: projectRoot,
        env,
        step: "issue.edit.format.invalid",
        contains: "Invalid --format value",
      }
    );
    runExpectedFailure(
      [
        "node",
        cliPath,
        "issue",
        "edit",
        issueId,
        "--org",
        organizationId,
        "--title",
        "x",
        "--format",
        "table",
        "--out",
        path.join(tmpRoot, `issue-edit-invalid-out-${runId}.txt`),
      ],
      {
        cwd: projectRoot,
        env,
        step: "issue.edit.out.table.invalid",
        contains: "--out` requires --format tsv/json",
      }
    );

    const issueFieldSetCandidate = findIssueFieldSetCandidate(issueFieldsResult);
    if (issueFieldSetCandidate && currentUserId) {
      runSoft(
        [
          "issue",
          "field-set",
          issueId,
          "--org",
          organizationId,
          "--field",
          issueFieldSetCandidate,
          "--value",
          currentUserId,
          "--format",
          "json",
        ],
        "issue.field-set.format.json",
        warnings
      );
    } else {
      warnings.push("issue.field-set skipped: cannot find writable field candidate from issue fields result.");
    }
    runExpectedFailure(
      [
        "node",
        cliPath,
        "issue",
        "field-set",
        issueId,
        "--org",
        organizationId,
        "--field",
        "assignedTo",
        "--value",
        "x",
        "--format",
        "bad",
      ],
      {
        cwd: projectRoot,
        env,
        step: "issue.field-set.format.invalid",
        contains: "Invalid --format value",
      }
    );
    runExpectedFailure(
      [
        "node",
        cliPath,
        "issue",
        "field-set",
        issueId,
        "--org",
        organizationId,
        "--field",
        "assignedTo",
        "--value",
        "x",
        "--format",
        "table",
        "--out",
        path.join(tmpRoot, `issue-field-set-invalid-out-${runId}.txt`),
      ],
      {
        cwd: projectRoot,
        env,
        step: "issue.field-set.out.table.invalid",
        contains: "--out` requires --format tsv/json",
      }
    );

    const issueAssignFormatJson = runJson(
      ["issue", "assign", issueId, "--org", organizationId, "--assignee", "self", "--format", "json"],
      {
        step: "issue.assign.format.json",
      }
    );
    if (!isRecord(issueAssignFormatJson)) {
      fail("issue assign --format json verification failed: invalid response shape");
    }
    const issueAssignFormatTsvOutput = runChecked(
      ["node", cliPath, "issue", "assign", issueId, "--org", organizationId, "--assignee", "self", "--format", "tsv"],
      {
        cwd: projectRoot,
        env,
        step: "issue.assign.format.tsv",
      }
    ).stdout.trim();
    if (!issueAssignFormatTsvOutput.includes("key\tvalue")) {
      fail("issue assign --format tsv verification failed: missing tsv header");
    }
    const issueAssignOutPath = path.join(tmpRoot, `issue-assign-${runId}.tsv`);
    runChecked(
      [
        "node",
        cliPath,
        "issue",
        "assign",
        issueId,
        "--org",
        organizationId,
        "--assignee",
        "self",
        "--format",
        "tsv",
        "--out",
        issueAssignOutPath,
      ],
      {
        cwd: projectRoot,
        env,
        step: "issue.assign.out.tsv",
      }
    );
    if (!fs.existsSync(issueAssignOutPath)) {
      fail("issue assign --out verification failed: output file not found");
    }
    const issueAssignOutText = fs.readFileSync(issueAssignOutPath, "utf-8");
    if (!issueAssignOutText.includes("key\tvalue")) {
      fail("issue assign --out verification failed: missing tsv header");
    }
    runExpectedFailure(
      ["node", cliPath, "issue", "assign", issueId, "--org", organizationId, "--assignee", "self", "--format", "bad"],
      {
        cwd: projectRoot,
        env,
        step: "issue.assign.format.invalid",
        contains: "Invalid --format value",
      }
    );
    runExpectedFailure(
      [
        "node",
        cliPath,
        "issue",
        "assign",
        issueId,
        "--org",
        organizationId,
        "--assignee",
        "self",
        "--format",
        "table",
        "--out",
        path.join(tmpRoot, `issue-assign-invalid-out-${runId}.txt`),
      ],
      {
        cwd: projectRoot,
        env,
        step: "issue.assign.out.table.invalid",
        contains: "--out` requires --format tsv/json",
      }
    );

    runSoft(
      ["issue", "unassign", issueId, "--org", organizationId, "--format", "json"],
      "issue.unassign.format.json",
      warnings
    );
    runExpectedFailure(
      ["node", cliPath, "issue", "unassign", issueId, "--org", organizationId, "--format", "bad"],
      {
        cwd: projectRoot,
        env,
        step: "issue.unassign.format.invalid",
        contains: "Invalid --format value",
      }
    );
    runExpectedFailure(
      [
        "node",
        cliPath,
        "issue",
        "unassign",
        issueId,
        "--org",
        organizationId,
        "--format",
        "table",
        "--out",
        path.join(tmpRoot, `issue-unassign-invalid-out-${runId}.txt`),
      ],
      {
        cwd: projectRoot,
        env,
        step: "issue.unassign.out.table.invalid",
        contains: "--out` requires --format tsv/json",
      }
    );

    const issueCommentBody = `issue e2e comment ${Date.now()}`;
    const commentResult = runJson(
      [
        "issue",
        "comment",
        issueId,
        "--org",
        organizationId,
        "--body",
        issueCommentBody,
        "--json",
      ],
      {
        step: "issue.comment",
      }
    );
    const issueCommentFormatTsvOutput = runChecked(
      ["node", cliPath, "issue", "comment", issueId, "--org", organizationId, "--body", `issue e2e comment tsv ${runId}`, "--format", "tsv"],
      {
        cwd: projectRoot,
        env,
        step: "issue.comment.format.tsv",
      }
    ).stdout.trim();
    if (!issueCommentFormatTsvOutput.includes("key\tvalue")) {
      fail("issue comment --format tsv verification failed: missing tsv header");
    }
    const issueCommentOutPath = path.join(tmpRoot, `issue-comment-${runId}.tsv`);
    runChecked(
      [
        "node",
        cliPath,
        "issue",
        "comment",
        issueId,
        "--org",
        organizationId,
        "--body",
        `issue e2e comment out ${runId}`,
        "--format",
        "tsv",
        "--out",
        issueCommentOutPath,
      ],
      {
        cwd: projectRoot,
        env,
        step: "issue.comment.out.tsv",
      }
    );
    if (!fs.existsSync(issueCommentOutPath)) {
      fail("issue comment --out verification failed: output file not found");
    }
    const issueCommentOutText = fs.readFileSync(issueCommentOutPath, "utf-8");
    if (!issueCommentOutText.includes("key\tvalue")) {
      fail("issue comment --out verification failed: missing tsv header");
    }
    runExpectedFailure(
      ["node", cliPath, "issue", "comment", issueId, "--org", organizationId, "--body", "x", "--format", "bad"],
      {
        cwd: projectRoot,
        env,
        step: "issue.comment.format.invalid",
        contains: "Invalid --format value",
      }
    );
    runExpectedFailure(
      [
        "node",
        cliPath,
        "issue",
        "comment",
        issueId,
        "--org",
        organizationId,
        "--body",
        "x",
        "--format",
        "table",
        "--out",
        path.join(tmpRoot, `issue-comment-invalid-out-${runId}.txt`),
      ],
      {
        cwd: projectRoot,
        env,
        step: "issue.comment.out.table.invalid",
        contains: "--out` requires --format tsv/json",
      }
    );
    issueCommentId = readFirstString(commentResult, [
      "id",
      "commentId",
      "identifier",
      "result.id",
      "result.commentId",
      "result.identifier",
    ]);
    const commentsResult = runJson(["issue", "comments", issueId, "--org", organizationId, "--json"], {
      step: "issue.comments",
    });
    const issueCommentsFormatJson = runJson(
      ["issue", "comments", issueId, "--org", organizationId, "--format", "json"],
      {
        step: "issue.comments.format.json",
      }
    );
    if (!Array.isArray(issueCommentsFormatJson) && !isRecord(issueCommentsFormatJson)) {
      fail("issue comments --format json verification failed: invalid response shape");
    }
    const issueCommentsFormatTsvOutput = runChecked(
      ["node", cliPath, "issue", "comments", issueId, "--org", organizationId, "--format", "tsv"],
      {
        cwd: projectRoot,
        env,
        step: "issue.comments.format.tsv",
      }
    ).stdout.trim();
    if (!issueCommentsFormatTsvOutput.includes("id\tcommentId\tcontent\tcreator\tcreatedAt\tupdatedAt")) {
      fail("issue comments --format tsv verification failed: missing tsv header");
    }
    const issueCommentsOutPath = path.join(tmpRoot, `issue-comments-${runId}.tsv`);
    runChecked(
      [
        "node",
        cliPath,
        "issue",
        "comments",
        issueId,
        "--org",
        organizationId,
        "--format",
        "tsv",
        "--out",
        issueCommentsOutPath,
      ],
      {
        cwd: projectRoot,
        env,
        step: "issue.comments.out.tsv",
      }
    );
    if (!fs.existsSync(issueCommentsOutPath)) {
      fail("issue comments --out verification failed: output file not found");
    }
    const issueCommentsOutText = fs.readFileSync(issueCommentsOutPath, "utf-8");
    if (!issueCommentsOutText.includes("id\tcommentId\tcontent\tcreator\tcreatedAt\tupdatedAt")) {
      fail("issue comments --out verification failed: missing tsv header");
    }
    runExpectedFailure(
      ["node", cliPath, "issue", "comments", issueId, "--org", organizationId, "--format", "bad"],
      {
        cwd: projectRoot,
        env,
        step: "issue.comments.format.invalid",
        contains: "Invalid --format value",
      }
    );
    runExpectedFailure(
      [
        "node",
        cliPath,
        "issue",
        "comments",
        issueId,
        "--org",
        organizationId,
        "--format",
        "table",
        "--out",
        path.join(tmpRoot, `issue-comments-invalid-out-${runId}.txt`),
      ],
      {
        cwd: projectRoot,
        env,
        step: "issue.comments.out.table.invalid",
        contains: "--out` requires --format tsv/json",
      }
    );
    if (!issueCommentId) {
      issueCommentId = findIssueCommentId(commentsResult, issueCommentBody);
    }
    if (!issueCommentId) {
      fail("issue comment id not detected; cannot run comment-edit/comment-delete");
    }
    runExpectedFailure(
      [
        "node",
        cliPath,
        "issue",
        "comment-edit",
        issueId,
        issueCommentId,
        "--org",
        organizationId,
        "--body",
        "x",
        "--format",
        "bad",
      ],
      {
        cwd: projectRoot,
        env,
        step: "issue.comment-edit.format.invalid",
        contains: "Invalid --format value",
      }
    );
    runExpectedFailure(
      [
        "node",
        cliPath,
        "issue",
        "comment-edit",
        issueId,
        issueCommentId,
        "--org",
        organizationId,
        "--body",
        "x",
        "--format",
        "table",
        "--out",
        path.join(tmpRoot, `issue-comment-edit-invalid-out-${runId}.txt`),
      ],
      {
        cwd: projectRoot,
        env,
        step: "issue.comment-edit.out.table.invalid",
        contains: "--out` requires --format tsv/json",
      }
    );
    runSoft(
      [
        "issue",
        "comment-edit",
        issueId,
        issueCommentId,
        "--org",
        organizationId,
        "--body",
        "issue e2e comment (edited)",
        "--json",
      ],
      "issue.comment-edit",
      warnings
    );
    runExpectedFailure(
      [
        "node",
        cliPath,
        "issue",
        "comment-delete",
        issueId,
        issueCommentId,
        "--org",
        organizationId,
        "--yes",
        "--format",
        "bad",
      ],
      {
        cwd: projectRoot,
        env,
        step: "issue.comment-delete.format.invalid",
        contains: "Invalid --format value",
      }
    );
    runExpectedFailure(
      [
        "node",
        cliPath,
        "issue",
        "comment-delete",
        issueId,
        issueCommentId,
        "--org",
        organizationId,
        "--yes",
        "--format",
        "table",
        "--out",
        path.join(tmpRoot, `issue-comment-delete-invalid-out-${runId}.txt`),
      ],
      {
        cwd: projectRoot,
        env,
        step: "issue.comment-delete.out.table.invalid",
        contains: "--out` requires --format tsv/json",
      }
    );
    runSoft(
      ["issue", "comment-delete", issueId, issueCommentId, "--org", organizationId, "--yes", "--json"],
      "issue.comment-delete",
      warnings
    );
    issueCommentId = undefined;

    const issueCloseFormatJson = runJson(["issue", "close", issueId, "--org", organizationId, "--format", "json"], {
      step: "issue.close.format.json",
    });
    if (!isRecord(issueCloseFormatJson)) {
      fail("issue close --format json verification failed: invalid response shape");
    }
    const issueReopenFormatJson = runJson(["issue", "reopen", issueId, "--org", organizationId, "--format", "json"], {
      step: "issue.reopen.format.json",
    });
    if (!isRecord(issueReopenFormatJson)) {
      fail("issue reopen --format json verification failed: invalid response shape");
    }
    const issueCloseFormatTsvOutput = runChecked(
      ["node", cliPath, "issue", "close", issueId, "--org", organizationId, "--format", "tsv"],
      {
        cwd: projectRoot,
        env,
        step: "issue.close.format.tsv",
      }
    ).stdout.trim();
    if (!issueCloseFormatTsvOutput.includes("key\tvalue")) {
      fail("issue close --format tsv verification failed: missing tsv header");
    }
    const issueReopenFormatTsvOutput = runChecked(
      ["node", cliPath, "issue", "reopen", issueId, "--org", organizationId, "--format", "tsv"],
      {
        cwd: projectRoot,
        env,
        step: "issue.reopen.format.tsv",
      }
    ).stdout.trim();
    if (!issueReopenFormatTsvOutput.includes("key\tvalue")) {
      fail("issue reopen --format tsv verification failed: missing tsv header");
    }
    const issueCloseOutPath = path.join(tmpRoot, `issue-close-${runId}.tsv`);
    runChecked(
      ["node", cliPath, "issue", "close", issueId, "--org", organizationId, "--format", "tsv", "--out", issueCloseOutPath],
      {
        cwd: projectRoot,
        env,
        step: "issue.close.out.tsv",
      }
    );
    if (!fs.existsSync(issueCloseOutPath)) {
      fail("issue close --out verification failed: output file not found");
    }
    const issueCloseOutText = fs.readFileSync(issueCloseOutPath, "utf-8");
    if (!issueCloseOutText.includes("key\tvalue")) {
      fail("issue close --out verification failed: missing tsv header");
    }
    runJson(["issue", "reopen", issueId, "--org", organizationId, "--json"], {
      step: "issue.reopen.after-close-out",
    });
    runExpectedFailure(
      ["node", cliPath, "issue", "close", issueId, "--org", organizationId, "--format", "bad"],
      {
        cwd: projectRoot,
        env,
        step: "issue.close.format.invalid",
        contains: "Invalid --format value",
      }
    );
    runExpectedFailure(
      [
        "node",
        cliPath,
        "issue",
        "close",
        issueId,
        "--org",
        organizationId,
        "--format",
        "table",
        "--out",
        path.join(tmpRoot, `issue-close-invalid-out-${runId}.txt`),
      ],
      {
        cwd: projectRoot,
        env,
        step: "issue.close.out.table.invalid",
        contains: "--out` requires --format tsv/json",
      }
    );
    runExpectedFailure(
      ["node", cliPath, "issue", "reopen", issueId, "--org", organizationId, "--format", "bad"],
      {
        cwd: projectRoot,
        env,
        step: "issue.reopen.format.invalid",
        contains: "Invalid --format value",
      }
    );
    runExpectedFailure(
      [
        "node",
        cliPath,
        "issue",
        "reopen",
        issueId,
        "--org",
        organizationId,
        "--format",
        "table",
        "--out",
        path.join(tmpRoot, `issue-reopen-invalid-out-${runId}.txt`),
      ],
      {
        cwd: projectRoot,
        env,
        step: "issue.reopen.out.table.invalid",
        contains: "--out` requires --format tsv/json",
      }
    );

    runSoft(
      ["issue", "lock", issueId, "--org", organizationId, "--format", "json"],
      "issue.lock.format.json",
      warnings
    );
    runExpectedFailure(
      ["node", cliPath, "issue", "lock", issueId, "--org", organizationId, "--format", "bad"],
      {
        cwd: projectRoot,
        env,
        step: "issue.lock.format.invalid",
        contains: "Invalid --format value",
      }
    );
    runExpectedFailure(
      [
        "node",
        cliPath,
        "issue",
        "lock",
        issueId,
        "--org",
        organizationId,
        "--format",
        "table",
        "--out",
        path.join(tmpRoot, `issue-lock-invalid-out-${runId}.txt`),
      ],
      {
        cwd: projectRoot,
        env,
        step: "issue.lock.out.table.invalid",
        contains: "--out` requires --format tsv/json",
      }
    );
    runSoft(
      ["issue", "unlock", issueId, "--org", organizationId, "--format", "json"],
      "issue.unlock.format.json",
      warnings
    );
    runExpectedFailure(
      ["node", cliPath, "issue", "unlock", issueId, "--org", organizationId, "--format", "bad"],
      {
        cwd: projectRoot,
        env,
        step: "issue.unlock.format.invalid",
        contains: "Invalid --format value",
      }
    );
    runExpectedFailure(
      [
        "node",
        cliPath,
        "issue",
        "unlock",
        issueId,
        "--org",
        organizationId,
        "--format",
        "table",
        "--out",
        path.join(tmpRoot, `issue-unlock-invalid-out-${runId}.txt`),
      ],
      {
        cwd: projectRoot,
        env,
        step: "issue.unlock.out.table.invalid",
        contains: "--out` requires --format tsv/json",
      }
    );
    runSoft(
      ["issue", "pin", issueId, "--org", organizationId, "--format", "json"],
      "issue.pin.format.json",
      warnings
    );
    runExpectedFailure(
      ["node", cliPath, "issue", "pin", issueId, "--org", organizationId, "--format", "bad"],
      {
        cwd: projectRoot,
        env,
        step: "issue.pin.format.invalid",
        contains: "Invalid --format value",
      }
    );
    runExpectedFailure(
      [
        "node",
        cliPath,
        "issue",
        "pin",
        issueId,
        "--org",
        organizationId,
        "--format",
        "table",
        "--out",
        path.join(tmpRoot, `issue-pin-invalid-out-${runId}.txt`),
      ],
      {
        cwd: projectRoot,
        env,
        step: "issue.pin.out.table.invalid",
        contains: "--out` requires --format tsv/json",
      }
    );
    runSoft(
      ["issue", "unpin", issueId, "--org", organizationId, "--format", "json"],
      "issue.unpin.format.json",
      warnings
    );
    runExpectedFailure(
      ["node", cliPath, "issue", "unpin", issueId, "--org", organizationId, "--format", "bad"],
      {
        cwd: projectRoot,
        env,
        step: "issue.unpin.format.invalid",
        contains: "Invalid --format value",
      }
    );
    runExpectedFailure(
      [
        "node",
        cliPath,
        "issue",
        "unpin",
        issueId,
        "--org",
        organizationId,
        "--format",
        "table",
        "--out",
        path.join(tmpRoot, `issue-unpin-invalid-out-${runId}.txt`),
      ],
      {
        cwd: projectRoot,
        env,
        step: "issue.unpin.out.table.invalid",
        contains: "--out` requires --format tsv/json",
      }
    );

    const issueDeleteFormatCase = runJson(
      [
        "issue",
        "create",
        "--org",
        organizationId,
        "--project",
        projectId,
        "--title",
        `e2e smoke issue delete format ${runId}`,
        "--body",
        "created by smoke script for issue delete format checks",
        "--json",
      ],
      { step: "issue.delete.format.setup" }
    );
    issueDeleteFormatId = readFirstString(issueDeleteFormatCase, ["id", "identifier", "result.id", "result.identifier"]);
    if (!issueDeleteFormatId) {
      fail("issue delete format setup returned no issue id");
    }
    runExpectedFailure(
      [
        "node",
        cliPath,
        "issue",
        "delete",
        issueDeleteFormatId,
        "--org",
        organizationId,
        "--yes",
        "--format",
        "bad",
      ],
      {
        cwd: projectRoot,
        env,
        step: "issue.delete.format.invalid",
        contains: "Invalid --format value",
      }
    );
    runExpectedFailure(
      [
        "node",
        cliPath,
        "issue",
        "delete",
        issueDeleteFormatId,
        "--org",
        organizationId,
        "--yes",
        "--format",
        "table",
        "--out",
        path.join(tmpRoot, `issue-delete-invalid-out-${runId}.txt`),
      ],
      {
        cwd: projectRoot,
        env,
        step: "issue.delete.out.table.invalid",
        contains: "--out` requires --format tsv/json",
      }
    );
    const issueDeleteFormatTsvOutput = runChecked(
      ["node", cliPath, "issue", "delete", issueDeleteFormatId, "--org", organizationId, "--yes", "--format", "tsv"],
      {
        cwd: projectRoot,
        env,
        step: "issue.delete.format.tsv",
      }
    ).stdout.trim();
    if (!issueDeleteFormatTsvOutput.includes("key\tvalue")) {
      fail("issue delete --format tsv verification failed: missing tsv header");
    }
    issueDeleteFormatId = undefined;

    const issueDeleteOutCase = runJson(
      [
        "issue",
        "create",
        "--org",
        organizationId,
        "--project",
        projectId,
        "--title",
        `e2e smoke issue delete out ${runId}`,
        "--body",
        "created by smoke script for issue delete out checks",
        "--json",
      ],
      { step: "issue.delete.out.setup" }
    );
    issueDeleteOutId = readFirstString(issueDeleteOutCase, ["id", "identifier", "result.id", "result.identifier"]);
    if (!issueDeleteOutId) {
      fail("issue delete out setup returned no issue id");
    }
    const issueDeleteOutPath = path.join(tmpRoot, `issue-delete-${runId}.tsv`);
    runChecked(
      [
        "node",
        cliPath,
        "issue",
        "delete",
        issueDeleteOutId,
        "--org",
        organizationId,
        "--yes",
        "--format",
        "tsv",
        "--out",
        issueDeleteOutPath,
      ],
      {
        cwd: projectRoot,
        env,
        step: "issue.delete.out.tsv",
      }
    );
    if (!fs.existsSync(issueDeleteOutPath)) {
      fail("issue delete --out verification failed: output file not found");
    }
    const issueDeleteOutText = fs.readFileSync(issueDeleteOutPath, "utf-8");
    if (!issueDeleteOutText.includes("key\tvalue")) {
      fail("issue delete --out verification failed: missing tsv header");
    }
    issueDeleteOutId = undefined;

    runJson(["issue", "delete", issueId, "--org", organizationId, "--yes", "--json"], {
      step: "issue.delete",
    });
    issueId = undefined;
    note(
      "issue",
      "list-format/list-out/create-format/create-out/view-format/view-out/update-format/update-out/edit-format/edit-out/status-format/status-out/activities-format/activities-out/fields-format/fields-out/field-set-format/assign-format/assign-out/unassign-format/transfer-format/develop-format/develop-out/comment/comment-format/comment-out/comments/comments-format/comments-out/comment-edit/comment-edit-format/comment-edit-out/comment-delete/comment-delete-format/comment-delete-out/close-format/close-out/reopen-format/lock-format/unlock-format/pin-format/unpin-format/delete-format/delete-out"
    );
  }

} catch (error) {
  status = "FAIL";
  errorMessage = sanitizeText(error instanceof Error ? error.message : String(error));
} finally {
  if (organizationId && orgSecretName) {
    runSoft(["secret", "delete", orgSecretName, "--org", organizationId, "--scope", "org", "--json"], "cleanup.secret.delete.org", warnings);
  }
  if (organizationId && repositoryId && repoSecretName) {
    runSoft(
      ["secret", "delete", repoSecretName, "--org", organizationId, "--scope", "repo", "--repo", repositoryId, "--json"],
      "cleanup.secret.delete.repo",
      warnings
    );
  }
  if (organizationId && pipelineSecretName && pipelineScopeId) {
    runSoft(
      [
        "secret",
        "delete",
        pipelineSecretName,
        "--org",
        organizationId,
        "--scope",
        "pipeline",
        "--pipeline",
        pipelineScopeId,
        "--json",
      ],
      "cleanup.secret.delete.pipeline",
      warnings
    );
  }
  if (organizationId && repositoryId && createdLabelName) {
    runSoft(
      ["label", "delete", createdLabelName, "--repo", repositoryId, "--org", organizationId, "--yes", "--json"],
      "cleanup.label.delete",
      warnings
    );
  }
  if (organizationId && repositoryId && createdReleaseTag) {
    runSoft(
      ["release", "delete", createdReleaseTag, "--repo", repositoryId, "--org", organizationId, "--yes", "--json"],
      "cleanup.release.delete",
      warnings
    );
  }
  if (organizationId && repositoryId && webhookId) {
    runSoft(
      ["repo", "webhook", "delete", repositoryId, webhookId, "--org", organizationId, "--yes", "--json"],
      "cleanup.repo.webhook.delete",
      warnings
    );
  }
  if (organizationId && issueCommentId && issueId) {
    runSoft(
      ["issue", "comment-delete", issueId, issueCommentId, "--org", organizationId, "--yes", "--json"],
      "cleanup.issue.comment-delete",
      warnings
    );
  }
  if (organizationId && issueDeleteFormatId) {
    runSoft(["issue", "delete", issueDeleteFormatId, "--org", organizationId, "--yes", "--json"], "cleanup.issue.delete.format", warnings);
  }
  if (organizationId && issueDeleteOutId) {
    runSoft(["issue", "delete", issueDeleteOutId, "--org", organizationId, "--yes", "--json"], "cleanup.issue.delete.out", warnings);
  }
  if (organizationId && issueId) {
    runSoft(["issue", "delete", issueId, "--org", organizationId, "--yes", "--json"], "cleanup.issue.delete", warnings);
  }
  if (organizationId && projectCreatedBySmoke && projectId && projectNameCreatedBySmoke) {
    runSoft(
      [
        "org",
        "project-delete",
        projectId,
        "--org",
        organizationId,
        "--name",
        projectNameCreatedBySmoke,
        "--yes",
        "--json",
      ],
      "cleanup.org.project-delete",
      warnings
    );
  }

  if (repositoryId && organizationId) {
    try {
      runJson(["repo", "delete", repositoryId, "--org", organizationId, "--yes", "--json"], {
        step: "cleanup.repo.delete",
      });
    } catch (error) {
      warnings.push(`cleanup repo delete failed: ${sanitizeText(error instanceof Error ? error.message : String(error))}`);
      status = "FAIL";
    }
  }

  if (configSnapshot) {
    try {
      restoreUserConfig(configSnapshot);
    } catch (error) {
      warnings.push(`restore user config failed: ${sanitizeText(error instanceof Error ? error.message : String(error))}`);
      status = "FAIL";
    }
  }
}

const reportFilePath = path.join(tmpRoot, `smoke-report-${runId}.json`);
writeStructuredReport(reportFilePath, {
  runId,
  startedAt: runStartedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  status,
  organizationId,
  repositoryId,
  notes: report,
  warnings,
  errorMessage,
  steps: structuredStepReport,
});

printSummary(status, report, warnings, errorMessage, reportFilePath);
process.exit(status === "PASS" ? 0 : 1);

function runJson(args, input) {
  const result = runCli(args, input);
  const text = result.stdout.trim();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    const message = `${input.step}: expected JSON output, got: ${truncate(sanitizeText(text), 400)}`;
    structuredStepReport.push({
      step: `${input.step}.parse-json`,
      status: "FAIL",
      command: "(json-parse)",
      startedAt: new Date().toISOString(),
      durationMs: 0,
      error: message,
    });
    throw new Error(message);
  }
}

function runCli(args, input) {
  return runChecked(["node", cliPath, ...args], {
    cwd: projectRoot,
    env,
    step: input.step,
  });
}

function runSoft(args, step, warningList) {
  const beforeSize = structuredStepReport.length;
  try {
    runJson(args, { step });
  } catch (error) {
    for (let i = beforeSize; i < structuredStepReport.length; i += 1) {
      const item = structuredStepReport[i];
      if (item && item.step && String(item.step).startsWith(step) && item.status === "FAIL") {
        item.status = "SOFT_FAIL";
      }
    }
    warningList.push(`${step} skipped: ${sanitizeText(error instanceof Error ? error.message : String(error))}`);
  }
}

function runChecked(commandParts, options) {
  const startedAt = new Date();
  const startedMs = Date.now();
  const sanitizedCommand = sanitizeCommandParts(commandParts).join(" ");
  const step = options.step ?? "(unknown-step)";
  const [command, ...args] = commandParts;
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? projectRoot,
    env: options.env ?? env,
    encoding: "utf-8",
    stdio: options.passthrough ? options.stdio : "pipe",
  });
  const durationMs = Date.now() - startedMs;

  if (result.error) {
    const message = sanitizeText(result.error.message);
    structuredStepReport.push({
      step,
      status: "FAIL",
      command: sanitizedCommand,
      startedAt: startedAt.toISOString(),
      durationMs,
      exitCode: null,
      error: message,
    });
    throw new Error(`${step} failed: ${message}`);
  }
  if (result.status !== 0) {
    const stderr = sanitizeText((result.stderr || "").trim());
    const stdout = sanitizeText((result.stdout || "").trim());
    const message = stderr || stdout || `exit=${String(result.status)}`;
    structuredStepReport.push({
      step,
      status: "FAIL",
      command: sanitizedCommand,
      startedAt: startedAt.toISOString(),
      durationMs,
      exitCode: result.status,
      stderr: truncate(stderr, 400),
      stdout: truncate(stdout, 400),
    });
    throw new Error(`${step} failed: ${message}`);
  }

  structuredStepReport.push({
    step,
    status: "PASS",
    command: sanitizedCommand,
    startedAt: startedAt.toISOString(),
    durationMs,
    exitCode: 0,
  });
  return result;
}

function runExpectedFailure(commandParts, options) {
  const startedAt = new Date();
  const startedMs = Date.now();
  const sanitizedCommand = sanitizeCommandParts(commandParts).join(" ");
  const step = options.step ?? "(unknown-step)";
  const [command, ...args] = commandParts;
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? projectRoot,
    env: options.env ?? env,
    encoding: "utf-8",
    stdio: options.passthrough ? options.stdio : "pipe",
  });
  const durationMs = Date.now() - startedMs;

  if (result.error) {
    const message = sanitizeText(result.error.message);
    structuredStepReport.push({
      step,
      status: "FAIL",
      command: sanitizedCommand,
      startedAt: startedAt.toISOString(),
      durationMs,
      exitCode: null,
      error: message,
    });
    throw new Error(`${step} failed: ${message}`);
  }

  const stderr = sanitizeText((result.stderr || "").trim());
  const stdout = sanitizeText((result.stdout || "").trim());
  const combined = `${stderr}\n${stdout}`.trim();

  if (result.status === 0) {
    structuredStepReport.push({
      step,
      status: "FAIL",
      command: sanitizedCommand,
      startedAt: startedAt.toISOString(),
      durationMs,
      exitCode: 0,
      stderr: truncate(stderr, 400),
      stdout: truncate(stdout, 400),
    });
    throw new Error(`${step} failed: expected non-zero exit code`);
  }

  if (options.contains && !combined.includes(options.contains)) {
    structuredStepReport.push({
      step,
      status: "FAIL",
      command: sanitizedCommand,
      startedAt: startedAt.toISOString(),
      durationMs,
      exitCode: result.status,
      stderr: truncate(stderr, 400),
      stdout: truncate(stdout, 400),
    });
    throw new Error(`${step} failed: expected output to include "${options.contains}"`);
  }

  structuredStepReport.push({
    step,
    status: "PASS",
    command: sanitizedCommand,
    startedAt: startedAt.toISOString(),
    durationMs,
    exitCode: result.status,
  });
  return result;
}

function note(step, value) {
  report.push({ step, value });
}

function printSummary(status, notes, warningList, errorMessage, reportPath) {
  const head = `\n=== E2E ${status} ===`;
  process.stdout.write(`${head}\n`);
  for (const item of notes) {
    process.stdout.write(`- ${item.step}: ${item.value}\n`);
  }
  if (warningList.length) {
    process.stdout.write("\nWarnings:\n");
    for (const warning of warningList) {
      process.stdout.write(`- ${warning}\n`);
    }
  }
  if (errorMessage) {
    process.stdout.write(`\nError: ${errorMessage}\n`);
  }
  if (reportPath) {
    process.stdout.write(`\nStructured report: ${reportPath}\n`);
  }
}

function writeStructuredReport(filePath, payload) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
}

function loadDotEnv(filePath, targetEnv) {
  if (!fs.existsSync(filePath)) {
    return;
  }
  const text = fs.readFileSync(filePath, "utf-8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const index = trimmed.indexOf("=");
    if (index <= 0) {
      continue;
    }
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && !(key in targetEnv)) {
      targetEnv[key] = value;
    }
  }
}

function readFirstString(input, keys) {
  for (const key of keys) {
    const value = readPath(input, key);
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(Math.round(value));
    }
  }
  return undefined;
}

function readTsvValue(text, key) {
  if (!text || !key) {
    return undefined;
  }
  const lines = String(text).split(/\r?\n/);
  for (const line of lines) {
    const [left, right] = line.split("\t");
    if (left === key && typeof right === "string" && right.trim()) {
      return right.trim();
    }
  }
  return undefined;
}

function readPath(input, keyPath) {
  if (!keyPath.includes(".")) {
    return isRecord(input) ? input[keyPath] : undefined;
  }
  const parts = keyPath.split(".");
  let current = input;
  for (const part of parts) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

function randomUppercaseCode(length) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let output = "";
  for (let i = 0; i < length; i += 1) {
    output += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return output;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ensureDir(target) {
  fs.mkdirSync(target, { recursive: true });
}

function cleanPath(target) {
  if (fs.existsSync(target)) {
    fs.rmSync(target, { recursive: true, force: true });
  }
}

function backupUserConfig() {
  const configPath = path.join(os.homedir(), ".yx", "config.json");
  if (!fs.existsSync(configPath)) {
    return {
      configPath,
      existed: false,
      raw: "",
    };
  }
  return {
    configPath,
    existed: true,
    raw: fs.readFileSync(configPath, "utf-8"),
  };
}

function restoreUserConfig(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    return;
  }
  const configPath = typeof snapshot.configPath === "string" ? snapshot.configPath : "";
  if (!configPath) {
    return;
  }
  if (snapshot.existed !== true) {
    if (fs.existsSync(configPath)) {
      fs.rmSync(configPath, { force: true });
    }
    return;
  }
  ensureDir(path.dirname(configPath));
  fs.writeFileSync(configPath, typeof snapshot.raw === "string" ? snapshot.raw : "", "utf-8");
}

function writeText(filePath, content) {
  fs.writeFileSync(filePath, content, "utf-8");
}

function hasRepositoryLabel(payload, labelName) {
  if (Array.isArray(payload)) {
    return payload.some((item) => readFirstString(item, ["name"]) === labelName);
  }
  if (isRecord(payload) && Array.isArray(payload.labels)) {
    return payload.labels.some((item) => readFirstString(item, ["name"]) === labelName);
  }
  return false;
}

function hasRelease(payload, tagName) {
  if (!Array.isArray(payload)) {
    return false;
  }
  return payload.some((item) => isRecord(item) && readFirstString(item, ["tagName", "name", "tag"]) === tagName);
}

function hasSecret(payload, secretName, scope) {
  if (!Array.isArray(payload)) {
    return false;
  }
  return payload.some(
    (item) =>
      isRecord(item) &&
      readFirstString(item, ["name"]) === secretName &&
      readFirstString(item, ["scope"]) === scope
  );
}

function hasCommitStatus(payload, context) {
  const statuses = extractRecordArray(payload);
  return statuses.some((item) => readFirstString(item, ["context"]) === context);
}

function hasCheckRun(payload, checkRunId, checkRunName) {
  const runs = extractRecordArray(payload);
  return runs.some((item) => {
    const id = readFirstString(item, ["id", "checkRunId"]);
    const name = readFirstString(item, ["name"]);
    return id === checkRunId || name === checkRunName;
  });
}

function hasWebhook(payload, hookId) {
  const hooks = extractRecordArray(payload);
  return hooks.some((item) => readFirstString(item, ["id", "hookId"]) === hookId);
}

function findIssueCommentId(payload, expectedBodyText) {
  const comments = extractRecordArray(payload);
  for (const item of comments) {
    const body =
      readFirstString(item, ["content", "body", "text", "comment"]) ??
      "";
    if (!body.includes(expectedBodyText)) {
      continue;
    }
    const id = readFirstString(item, ["id", "commentId", "identifier", "result.id", "result.commentId", "result.identifier"]);
    if (id) {
      return id;
    }
  }
  return undefined;
}

function findWorkitemCommentId(payload, expectedBodyText) {
  const comments = extractRecordArray(payload);
  for (const item of comments) {
    const body =
      readFirstString(item, ["content", "body", "text", "comment"]) ??
      "";
    if (!body.includes(expectedBodyText)) {
      continue;
    }
    const id = readFirstString(item, ["id", "commentId", "identifier", "result.id", "result.commentId", "result.identifier"]);
    if (id) {
      return id;
    }
  }
  return undefined;
}

function findIssueFieldSetCandidate(payload) {
  if (!isRecord(payload)) {
    return undefined;
  }
  const directFields = Array.isArray(payload.fields) ? payload.fields.filter(isRecord) : [];
  const fields = directFields.length ? directFields : extractRecordArray(payload);
  if (!fields.length) {
    return undefined;
  }

  const preferredIds = ["assignedTo", "owner", "priority", "severity"];
  for (const preferredId of preferredIds) {
    const hit = fields.find((field) => readFirstString(field, ["id"]) === preferredId);
    if (hit) {
      return preferredId;
    }
  }

  for (const field of fields) {
    const fieldId = readFirstString(field, ["id"]);
    const readOnly = readPath(field, "readOnly");
    if (fieldId && readOnly !== true) {
      return fieldId;
    }
  }
  return undefined;
}

function extractSprintRecords(payload) {
  if (Array.isArray(payload)) {
    return payload.filter(isRecord);
  }
  if (isRecord(payload) && Array.isArray(payload.sprints)) {
    return payload.sprints.filter(isRecord);
  }
  return extractRecordArray(payload);
}

function extractMilestoneRecords(payload) {
  if (Array.isArray(payload)) {
    return payload.filter(isRecord);
  }
  if (isRecord(payload) && Array.isArray(payload.milestones)) {
    return payload.milestones.filter(isRecord);
  }
  return extractRecordArray(payload);
}

function extractVersionRecords(payload) {
  if (Array.isArray(payload)) {
    return payload.filter(isRecord);
  }
  if (isRecord(payload) && Array.isArray(payload.versions)) {
    return payload.versions.filter(isRecord);
  }
  return extractRecordArray(payload);
}

function extractRoleIds(payload) {
  const roles = extractRecordArray(payload);
  const roleIds = new Set();
  for (const role of roles) {
    const roleId = readFirstString(role, ["id", "identifier", "roleId", "code"]);
    if (roleId) {
      roleIds.add(roleId);
    }
  }
  return [...roleIds];
}

function chooseProjectRoleForSmoke(input) {
  const projectRoleSet = new Set(input.projectRoleIds);
  const preferredRoleOrder = [
    "project.developer",
    "project.tester",
    "project.operator",
    "project.product",
    "project.manager",
    "project.participant",
    "project.admin",
  ];

  for (const roleId of preferredRoleOrder) {
    if (input.orgRoleIds.includes(roleId) && !projectRoleSet.has(roleId)) {
      return roleId;
    }
  }

  for (const roleId of input.orgRoleIds) {
    if (!projectRoleSet.has(roleId)) {
      return roleId;
    }
  }

  return undefined;
}

function extractRecordArray(payload) {
  if (Array.isArray(payload)) {
    return payload.filter(isRecord);
  }
  if (!isRecord(payload)) {
    return [];
  }
  for (const key of ["comments", "items", "records", "result", "data"]) {
    if (Array.isArray(payload[key])) {
      return payload[key].filter(isRecord);
    }
  }
  return [];
}

function sanitizeCommandParts(parts) {
  const output = [...parts];
  for (let i = 0; i < output.length; i += 1) {
    let value = String(output[i]);
    if (value === "--value" && i + 1 < output.length) {
      output[i + 1] = "***SECRET***";
    }
    value = sanitizeText(value);
    if (/^http\.extraHeader=x-yunxiao-token:/i.test(value)) {
      value = "http.extraHeader=x-yunxiao-token: ***TOKEN***";
    }
    output[i] = value;
  }
  return output;
}

function sanitizeText(text) {
  let value = String(text ?? "");
  if (token) {
    value = value.split(token).join("***TOKEN***");
  }
  value = value.replace(/(x-yunxiao-token:\s*)([^\s'"]+)/gi, "$1***TOKEN***");
  return value;
}

function truncate(text, maxLength) {
  if (!text || text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...(truncated)`;
}

function fail(message) {
  throw new Error(message);
}
