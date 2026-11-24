#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <userenv.h>
#include <sddl.h>
#include <objbase.h>
#include <cstdlib>
#include <filesystem>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>
namespace fs = std::filesystem;
static void requireWin(BOOL success, const char* operation) {
    if (!success) throw std::runtime_error(std::string(operation) + ": " + std::to_string(GetLastError()));
}

// Quote an argument using the Windows C runtime command-line rules.
static std::wstring quote(const std::wstring& value) {
    std::wstring out = L"\"";
    size_t slashes = 0;
    for (wchar_t c : value) {
        if (c == L'\\') { ++slashes; continue; }
        out.append(slashes * (c == L'"' ? 2 : 1) + (c == L'"' ? 1 : 0), L'\\');
        out += c;
        slashes = 0;
    }
    out.append(slashes * 2, L'\\');
    return out + L"\"";
}
struct Handle {
    HANDLE value = nullptr;
    ~Handle() { if (value && value != INVALID_HANDLE_VALUE) CloseHandle(value); }
};

static std::wstring systemDirectory() {
    wchar_t path[MAX_PATH];
    const UINT length = GetSystemDirectoryW(path, MAX_PATH);
    requireWin(length > 0 && length < MAX_PATH, "GetSystemDirectoryW");
    return path;
}
static std::wstring appIdentity() {
    GUID guid{};
    if (FAILED(CoCreateGuid(&guid))) throw std::runtime_error("Could not allocate AppContainer identity");
    wchar_t text[40]{};
    if (!StringFromGUID2(guid, text, 40)) throw std::runtime_error("Could not format identity");
    return L"OmpLiveMap." + std::wstring(text + 1, 36);
}
struct Profile {
    std::wstring name = appIdentity();
    PSID sid = nullptr;
    Profile() {
        const HRESULT result = CreateAppContainerProfile(name.c_str(), name.c_str(), name.c_str(), nullptr, 0, &sid);
        if (FAILED(result)) throw std::runtime_error("CreateAppContainerProfile: " + std::to_string(result));
    }
    ~Profile() { FreeSid(sid); DeleteAppContainerProfile(name.c_str()); }
};
struct Attributes {
    LPPROC_THREAD_ATTRIBUTE_LIST list = nullptr;
    std::vector<unsigned char> storage;
    explicit Attributes(DWORD count) {
        SIZE_T size = 0;
        InitializeProcThreadAttributeList(nullptr, count, 0, &size);
        if (!size) throw std::runtime_error("Could not size launch attributes");
        storage.resize(size);
        list = reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(storage.data());
        requireWin(InitializeProcThreadAttributeList(list, count, 0, &size), "Initialize launch attributes");
    }
    ~Attributes() { DeleteProcThreadAttributeList(list); }
    void add(DWORD_PTR key, void* value, SIZE_T size) {
        requireWin(UpdateProcThreadAttribute(list, 0, key, value, size, nullptr, nullptr), "Set launch attribute");
    }
};
static void acl(const fs::path& target, const std::wstring& arguments) {
    const auto executable = fs::path(systemDirectory()) / L"icacls.exe";
    auto command = quote(executable.wstring()) + L" " + quote(target.wstring()) + L" " + arguments + L" /Q /L";
    STARTUPINFOW start{};
    start.cb = sizeof start;
    PROCESS_INFORMATION process{};
    requireWin(CreateProcessW(executable.c_str(), command.data(), nullptr, nullptr, FALSE, CREATE_NO_WINDOW,
        nullptr, nullptr, &start, &process), "icacls launch");
    Handle thread{process.hThread}, child{process.hProcess};
    if (WaitForSingleObject(child.value, 15000) != WAIT_OBJECT_0) {
        TerminateProcess(child.value, 1);
        throw std::runtime_error("icacls timed out");
    }
    DWORD code = 0;
    requireWin(GetExitCodeProcess(child.value, &code), "icacls result");
    if (code) throw std::runtime_error("Workspace ACL setup failed: " + std::to_string(code));
}
struct Grants {
    fs::path work, runtime;
    std::wstring sid;
    bool workGranted = false, runtimeGranted = false;
    ~Grants() {
        try { if (workGranted) acl(work, L"/remove:g " + quote(sid)); } catch (...) {}
        try { if (runtimeGranted) acl(runtime, L"/remove:g " + quote(sid)); } catch (...) {}
    }
    void configure(PSID user) {
        wchar_t* value = nullptr;
        requireWin(ConvertSidToStringSidW(user, &value), "Format AppContainer SID");
        sid = L"*" + std::wstring(value);
        LocalFree(value);
        acl(work, L"/grant " + quote(sid + L":(OI)(CI)M"));
        workGranted = true;
        acl(work, L"/setintegritylevel (OI)(CI)L");
        acl(runtime, L"/grant " + quote(sid + L":(OI)(CI)RX"));
        runtimeGranted = true;
    }
};
static void rejectLinks(const fs::path& root) {
    auto check = [](const fs::path& path) {
        const DWORD attrs = GetFileAttributesW(path.c_str());
        if (attrs == INVALID_FILE_ATTRIBUTES || (attrs & FILE_ATTRIBUTE_REPARSE_POINT)) {
            throw std::runtime_error("Missing or redirected sandbox path");
        }
    };
    for (auto parent = root; parent.has_relative_path(); parent = parent.parent_path()) check(parent);
    for (const auto& entry : fs::recursive_directory_iterator(root)) {
        check(entry.path());
        if (entry.is_regular_file() && fs::hard_link_count(entry.path()) > 1) throw std::runtime_error("Hard links are not supported");
    }
}
static int execute(const fs::path& workspace, const fs::path& executable, int argc, wchar_t** argv) {
    const auto runtime = executable.parent_path();
    const auto relative = runtime.lexically_relative(workspace);
    if (!workspace.is_absolute() || !executable.is_absolute() ||
        relative.empty() || *relative.begin() != L"..") {
        throw std::runtime_error("Use a separate, read-only runtime directory");
    }
    rejectLinks(workspace);
    rejectLinks(runtime);
    Profile profile;
    Grants grants{workspace, runtime, L""};
    grants.configure(profile.sid);
    Handle job{CreateJobObjectW(nullptr, nullptr)};
    requireWin(job.value != nullptr, "Create process job");
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION options{};
    options.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_ACTIVE_PROCESS;
    options.BasicLimitInformation.ActiveProcessLimit = 1;
    requireWin(SetInformationJobObject(job.value, JobObjectExtendedLimitInformation, &options, sizeof options), "Set job limits");
    SECURITY_CAPABILITIES capabilities{};
    capabilities.AppContainerSid = profile.sid;
    DWORD childPolicy = PROCESS_CREATION_CHILD_PROCESS_RESTRICTED;
    Attributes attributes(4);
    attributes.add(PROC_THREAD_ATTRIBUTE_CHILD_PROCESS_POLICY, &childPolicy, sizeof childPolicy);
    attributes.add(PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES, &capabilities, sizeof capabilities);
    attributes.add(PROC_THREAD_ATTRIBUTE_JOB_LIST, &job.value, sizeof job.value);
    Handle input, output, error;
    Handle* streams[] = { &input, &output, &error };
    const DWORD ids[] = { STD_INPUT_HANDLE, STD_OUTPUT_HANDLE, STD_ERROR_HANDLE };
    HANDLE inherited[3]{};
    for (size_t i = 0; i < 3; ++i) {
        requireWin(DuplicateHandle(GetCurrentProcess(), GetStdHandle(ids[i]), GetCurrentProcess(),
            &streams[i]->value, 0, TRUE, DUPLICATE_SAME_ACCESS), "Duplicate standard handle");
        inherited[i] = streams[i]->value;
    }
    attributes.add(PROC_THREAD_ATTRIBUTE_HANDLE_LIST, inherited, sizeof inherited);
    STARTUPINFOEXW startup{};
    startup.StartupInfo.cb = sizeof startup;
    startup.lpAttributeList = attributes.list;
    startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    startup.StartupInfo.hStdInput = input.value;
    startup.StartupInfo.hStdOutput = output.value;
    startup.StartupInfo.hStdError = error.value;
    PROCESS_INFORMATION process{};
    std::wstring command = quote(executable.wstring());
    for (int i = 3; i < argc; ++i) command += L" " + quote(argv[i]);
    std::wstring environment;
    auto variable = [&](const wchar_t* name, const std::wstring& value) {
        environment += std::wstring(name) + L"=" + value + L'\0';
    };
    const auto systemRoot = fs::path(systemDirectory()).parent_path().wstring();
    variable(L"LOCALAPPDATA", _wgetenv(L"LOCALAPPDATA") ? _wgetenv(L"LOCALAPPDATA") : workspace.wstring());
    variable(L"PATH", systemDirectory());
    variable(L"SystemRoot", systemRoot);
    variable(L"TEMP", workspace.wstring());
    variable(L"TMP", workspace.wstring());
    variable(L"USERPROFILE", _wgetenv(L"USERPROFILE") ? _wgetenv(L"USERPROFILE") : workspace.wstring());
    requireWin(CreateProcessW(executable.c_str(), command.data(), nullptr, nullptr, TRUE,
        EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT | CREATE_NO_WINDOW,
        environment.data(), workspace.c_str(), &startup.StartupInfo, &process), "Launch AppContainer process");
    Handle thread{process.hThread}, child{process.hProcess};
    requireWin(WaitForSingleObject(child.value, INFINITE) == WAIT_OBJECT_0, "Wait for isolated command");
    DWORD code = 0;
    requireWin(GetExitCodeProcess(child.value, &code), "Read command exit code");
    return static_cast<int>(code);
}
int wmain(int argc, wchar_t** argv) {
    SetErrorMode(SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX | SEM_NOOPENFILEERRORBOX);
    if (argc < 3) return 125;
    try {
        return execute(fs::path(argv[1]).lexically_normal(), fs::path(argv[2]).lexically_normal(), argc, argv);
    } catch (const std::exception& error) {
        std::cerr << "Isolation launch failed: " << error.what() << '\n';
        return 125;
    }
}
