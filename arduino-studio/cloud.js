(() => {
  "use strict";

  const config = window.ONEMAKER_CLOUD_CONFIG || {};
  const configured = /^https:\/\/.+\.supabase\.co$/.test(config.supabaseUrl || "")
    && /^sb_(publishable|anon)_/.test(config.supabasePublishableKey || "");
  const accountButton = document.querySelector("#accountBtn");
  const cloudButton = document.querySelector("#cloudProjectsBtn");
  const accountDialog = document.querySelector("#accountDialog");
  const projectsDialog = document.querySelector("#cloudProjectsDialog");
  const status = document.querySelector("#cloudStatus");
  let client = null;
  let user = null;
  let profile = null;
  let currentProjectId = null;
  let autosaveTimer = null;
  let passwordRecovery = false;

  function toast(message) {
    window.OneMakerProjectApi?.toast(message);
  }

  function messageFor(error) {
    const message = String(error?.message || error || "오류가 발생했습니다.");
    if (/Invalid login credentials/i.test(message)) return "이메일 또는 비밀번호가 맞지 않습니다.";
    if (/User already registered/i.test(message)) return "이미 가입된 이메일입니다.";
    if (/duplicate key|profiles_username_key/i.test(message)) return "이미 사용 중인 아이디입니다.";
    if (/Password should be/i.test(message)) return "비밀번호는 8자 이상 입력해주세요.";
    if (/Email rate limit exceeded/i.test(message)) return "이메일 발송 한도를 초과했습니다. 잠시 후 다시 시도해주세요.";
    return message;
  }

  function setBusy(form, busy) {
    form.querySelectorAll("button,input").forEach(element => { element.disabled = busy; });
  }

  function showAuthView(name) {
    accountDialog.querySelectorAll("[data-auth-view]").forEach(view => {
      view.hidden = view.dataset.authView !== name;
    });
    accountDialog.querySelectorAll("[data-show-auth]").forEach(button => {
      button.classList.toggle("active", button.dataset.showAuth === name);
    });
  }

  function updateAccountUi() {
    const label = profile?.username || user?.email?.split("@")[0] || "로그인";
    accountButton.textContent = user ? `👤 ${label}` : "👤 로그인";
    accountButton.classList.toggle("signed-in", Boolean(user));
    cloudButton.hidden = !user;
    status.textContent = user ? `${label} 계정으로 로그인됨` : "로그인하면 여러 기기에서 프로젝트를 사용할 수 있습니다.";
    document.querySelector("#logoutBtn").hidden = !user;
    document.querySelector("#accountForms").hidden = Boolean(user) && !passwordRecovery;
    document.querySelector("#accountSignedIn").hidden = !user || passwordRecovery;
    if (user) {
      document.querySelector("#accountUsername").textContent = label;
      document.querySelector("#accountEmail").textContent = user.email || "";
    }
  }

  async function loadProfile() {
    profile = null;
    if (!user) return updateAccountUi();
    const { data } = await client.from("profiles").select("username").eq("id", user.id).maybeSingle();
    profile = data || null;
    updateAccountUi();
  }

  function openAccount() {
    if (!configured) return document.querySelector("#cloudSetupDialog").showModal();
    updateAccountUi();
    showAuthView("login");
    accountDialog.showModal();
  }

  async function signUp(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const username = String(values.get("username") || "").trim();
    const email = String(values.get("email") || "").trim();
    const password = String(values.get("password") || "");
    if (!/^[A-Za-z0-9_]{4,20}$/.test(username)) return toast("아이디는 영문·숫자·밑줄 4~20자로 입력해주세요.");
    if (password.length < 8) return toast("비밀번호는 8자 이상 입력해주세요.");
    if (password !== values.get("passwordConfirm")) return toast("비밀번호 확인이 일치하지 않습니다.");
    setBusy(form, true);
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: {
        data: { username },
        emailRedirectTo: `${location.origin}${location.pathname}`
      }
    });
    setBusy(form, false);
    if (error) return toast(messageFor(error));
    form.reset();
    if (data.session) {
      toast("회원가입과 로그인이 완료되었습니다.");
      accountDialog.close();
    } else {
      toast("가입 확인 이메일을 확인해주세요.");
      showAuthView("login");
    }
  }

  async function signIn(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(form, true);
    const { error } = await client.auth.signInWithPassword({
      email: String(values.get("email") || "").trim(),
      password: String(values.get("password") || "")
    });
    setBusy(form, false);
    if (error) return toast(messageFor(error));
    form.reset();
    accountDialog.close();
    toast("로그인했습니다.");
  }

  async function resetPassword(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const email = String(new FormData(form).get("email") || "").trim();
    setBusy(form, true);
    const { error } = await client.auth.resetPasswordForEmail(email, {
      redirectTo: `${location.origin}${location.pathname}`
    });
    setBusy(form, false);
    if (error) return toast(messageFor(error));
    form.reset();
    toast("비밀번호 재설정 이메일을 보냈습니다.");
    showAuthView("login");
  }

  async function updatePassword(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const password = String(values.get("password") || "");
    if (password.length < 8) return toast("비밀번호는 8자 이상 입력해주세요.");
    if (password !== values.get("passwordConfirm")) return toast("비밀번호 확인이 일치하지 않습니다.");
    setBusy(form, true);
    const { error } = await client.auth.updateUser({ password });
    setBusy(form, false);
    if (error) return toast(messageFor(error));
    passwordRecovery = false;
    updateAccountUi();
    form.reset();
    accountDialog.close();
    toast("새 비밀번호를 저장했습니다.");
  }

  async function signOut() {
    await client.auth.signOut();
    currentProjectId = null;
    accountDialog.close();
    toast("로그아웃했습니다. 현재 작업은 이 기기에 계속 저장됩니다.");
  }

  async function saveCloud(copy = false) {
    if (!user) return openAccount();
    const project = window.OneMakerProjectApi.getData();
    const record = { user_id: user.id, name: project.name, project_data: project, updated_at: new Date().toISOString() };
    let result;
    if (currentProjectId && !copy) {
      result = await client.from("projects").update(record).eq("id", currentProjectId).select("id").single();
    } else {
      result = await client.from("projects").insert(record).select("id").single();
    }
    if (result.error) return toast(messageFor(result.error));
    currentProjectId = result.data.id;
    toast(copy ? "새 클라우드 프로젝트로 저장했습니다." : "클라우드에 저장했습니다.");
    await renderProjects();
  }

  function projectRow(project) {
    const row = document.createElement("article");
    row.className = "cloud-project-row";
    const summary = document.createElement("div");
    const title = document.createElement("b");
    title.textContent = project.name;
    const date = document.createElement("small");
    date.textContent = new Date(project.updated_at).toLocaleString("ko-KR");
    summary.append(title, date);
    const actions = document.createElement("div");
    const open = document.createElement("button");
    open.type = "button";
    open.textContent = "열기";
    open.addEventListener("click", () => openCloudProject(project.id));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "danger-soft";
    remove.textContent = "삭제";
    remove.addEventListener("click", () => deleteCloudProject(project.id, project.name));
    actions.append(open, remove);
    row.append(summary, actions);
    return row;
  }

  async function renderProjects() {
    if (!user) return;
    const list = document.querySelector("#cloudProjectList");
    list.replaceChildren();
    list.dataset.loading = "true";
    const { data, error } = await client.from("projects")
      .select("id,name,updated_at")
      .order("updated_at", { ascending: false });
    delete list.dataset.loading;
    if (error) return toast(messageFor(error));
    if (!data.length) {
      const empty = document.createElement("p");
      empty.className = "cloud-empty";
      empty.textContent = "저장된 프로젝트가 없습니다.";
      list.append(empty);
      return;
    }
    data.forEach(project => list.append(projectRow(project)));
  }

  async function openCloudProject(id) {
    const { data, error } = await client.from("projects").select("id,project_data").eq("id", id).single();
    if (error) return toast(messageFor(error));
    currentProjectId = data.id;
    window.OneMakerProjectApi.loadData(data.project_data);
    projectsDialog.close();
    toast("클라우드 프로젝트를 열었습니다.");
  }

  async function deleteCloudProject(id, name) {
    if (!confirm(`‘${name}’ 프로젝트를 삭제할까요?`)) return;
    const { error } = await client.from("projects").delete().eq("id", id);
    if (error) return toast(messageFor(error));
    if (currentProjectId === id) currentProjectId = null;
    await renderProjects();
    toast("프로젝트를 삭제했습니다.");
  }

  function scheduleCloudAutosave(project) {
    if (!user || !currentProjectId) return;
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(async () => {
      const { error } = await client.from("projects").update({
        name: project.name,
        project_data: project,
        updated_at: new Date().toISOString()
      }).eq("id", currentProjectId);
      if (error) console.warn("Cloud autosave failed", error.message);
    }, 1800);
  }

  function bindEvents() {
    accountButton.addEventListener("click", openAccount);
    cloudButton.addEventListener("click", async () => {
      projectsDialog.showModal();
      await renderProjects();
    });
    document.querySelectorAll("[data-close-dialog]").forEach(button => button.addEventListener("click", () => {
      document.querySelector(button.dataset.closeDialog)?.close();
    }));
    accountDialog.querySelectorAll("[data-show-auth]").forEach(button => button.addEventListener("click", () => showAuthView(button.dataset.showAuth)));
    document.querySelector("#loginForm").addEventListener("submit", signIn);
    document.querySelector("#signupForm").addEventListener("submit", signUp);
    document.querySelector("#resetForm").addEventListener("submit", resetPassword);
    document.querySelector("#updatePasswordForm").addEventListener("submit", updatePassword);
    document.querySelector("#logoutBtn").addEventListener("click", signOut);
    document.querySelector("#cloudSaveBtn").addEventListener("click", () => saveCloud(false));
    document.querySelector("#cloudSaveAsBtn").addEventListener("click", () => saveCloud(true));
    window.addEventListener("onemaker:project-change", event => scheduleCloudAutosave(event.detail));
  }

  async function init() {
    bindEvents();
    if (!configured || !window.supabase?.createClient) {
      accountButton.classList.add("cloud-unconfigured");
      updateAccountUi();
      return;
    }
    client = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    const { data } = await client.auth.getSession();
    user = data.session?.user || null;
    await loadProfile();
    client.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") passwordRecovery = true;
      user = session?.user || null;
      if (!user) currentProjectId = null;
      setTimeout(loadProfile, 0);
      if (passwordRecovery) {
        document.querySelector("#accountForms").hidden = false;
        document.querySelector("#accountSignedIn").hidden = true;
        showAuthView("update");
        accountDialog.showModal();
      }
    });
  }

  init();
})();
