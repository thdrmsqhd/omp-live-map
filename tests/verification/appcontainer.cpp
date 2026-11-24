#define WIN32_LEAN_AND_MEAN
#include <winsock2.h>
#include <windows.h>
#include <userenv.h>
#include <sddl.h>
#include <filesystem>
#include <iostream>
#include <stdexcept>
#include <string>

namespace fs = std::filesystem;

static std::wstring quote(const std::wstring& value) { return L"\"" + value + L"\""; }

static bool appContainerToken() {
    HANDLE token;
    if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token)) return false;
    DWORD enabled = 0, size = 0;
    const BOOL ok = GetTokenInformation(token, TokenIsAppContainer, &enabled, sizeof enabled, &size);
    CloseHandle(token);
    return ok && enabled;
}

static DWORD run(const fs::path& program, const std::wstring& args, const fs::path& cwd,
                 STARTUPINFOEXW& startup, DWORD flags) {
    PROCESS_INFORMATION process{};
    std::wstring command = quote(program.wstring()) + L" " + args;
    if (!CreateProcessW(program.c_str(), command.data(), nullptr, nullptr, FALSE, flags,
                        nullptr, cwd.c_str(), &startup.StartupInfo, &process)) {
        throw std::runtime_error("CreateProcessW failed: " + std::to_string(GetLastError()));
    }
    CloseHandle(process.hThread);
    DWORD code = 124;
    if (WaitForSingleObject(process.hProcess, 10000) == WAIT_OBJECT_0) {
        GetExitCodeProcess(process.hProcess, &code);
    } else {
        TerminateProcess(process.hProcess, code);
        WaitForSingleObject(process.hProcess, 3000);
    }
    CloseHandle(process.hProcess);
    return code;
}

static bool privateFileDenied(const fs::path& file, DWORD access, DWORD disposition) {
    const HANDLE handle = CreateFileW(file.c_str(), access, FILE_SHARE_READ, nullptr,
                                     disposition, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (handle == INVALID_HANDLE_VALUE) return GetLastError() == ERROR_ACCESS_DENIED;
    CloseHandle(handle);
    return false;
}

static int sandboxProbe(const fs::path& privateFile, const wchar_t* port) {
    if (!appContainerToken()) return 11;
    HANDLE allowed = CreateFileW(L"allowed.txt", GENERIC_WRITE, 0, nullptr, CREATE_NEW, 0, nullptr);
    if (allowed == INVALID_HANDLE_VALUE) return 12;
    CloseHandle(allowed);
    if (!privateFileDenied(privateFile, GENERIC_READ, OPEN_EXISTING)) return 13;
    if (!privateFileDenied(privateFile, GENERIC_WRITE, OPEN_EXISTING)) return 14;

    WSADATA winsock{};
    if (WSAStartup(MAKEWORD(2, 2), &winsock) != 0) return 15;
    SOCKET client = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    sockaddr_in target{};
    target.sin_family = AF_INET;
    target.sin_port = htons(static_cast<u_short>(std::stoi(port)));
    target.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    const bool connected = client != INVALID_SOCKET &&
        connect(client, reinterpret_cast<sockaddr*>(&target), sizeof target) == 0;
    if (client != INVALID_SOCKET) closesocket(client);
    WSACleanup();
    if (connected) return 16;

    STARTUPINFOEXW child{};
    child.StartupInfo.cb = sizeof(STARTUPINFOW);
    return static_cast<int>(run(fs::current_path() / L"probe.exe", L"--child", fs::current_path(), child, 0));
}

static void grantWorkspace(const fs::path& directory, PSID sid) {
    wchar_t* sidText = nullptr;
    if (!ConvertSidToStringSidW(sid, &sidText)) throw std::runtime_error("Could not format sandbox SID");
    const std::wstring acl = std::wstring(L"*") + sidText + L":(OI)(CI)M";
    LocalFree(sidText);
    STARTUPINFOEXW startup{};
    startup.StartupInfo.cb = sizeof(STARTUPINFOW);
    const auto icacls = fs::path(L"C:/Windows/System32/icacls.exe");
    if (run(icacls, quote(directory.wstring()) + L" /grant " + quote(acl), directory, startup, 0) ||
        run(icacls, quote(directory.wstring()) + L" /setintegritylevel (OI)(CI)L", directory, startup, 0)) {
        throw std::runtime_error("Could not configure temporary workspace ACL");
    }
}

static int launchSandbox(const wchar_t* self, const fs::path& workspace, const fs::path& privateFile,
                         const wchar_t* port, const wchar_t* identity) {
    PSID sid = nullptr;
    const HRESULT hr = CreateAppContainerProfile(identity, identity, identity, nullptr, 0, &sid);
    if (FAILED(hr)) throw std::runtime_error("CreateAppContainerProfile failed: " + std::to_string(hr));
    STARTUPINFOEXW startup{};
    startup.StartupInfo.cb = sizeof startup;
    SIZE_T bytes = 0;
    InitializeProcThreadAttributeList(nullptr, 1, 0, &bytes);
    startup.lpAttributeList = static_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(HeapAlloc(GetProcessHeap(), 0, bytes));
    bool initialized = false;
    auto cleanup = [&] {
        if (initialized) DeleteProcThreadAttributeList(startup.lpAttributeList);
        if (startup.lpAttributeList) HeapFree(GetProcessHeap(), 0, startup.lpAttributeList);
        FreeSid(sid);
        DeleteAppContainerProfile(identity);
    };
    try {
        grantWorkspace(workspace, sid);
        const auto program = workspace / L"probe.exe";
        fs::copy_file(self, program);
        initialized = startup.lpAttributeList &&
            InitializeProcThreadAttributeList(startup.lpAttributeList, 1, 0, &bytes);
        SECURITY_CAPABILITIES capabilities{};
        capabilities.AppContainerSid = sid;
        if (!initialized || !UpdateProcThreadAttribute(startup.lpAttributeList, 0,
                PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES, &capabilities, sizeof capabilities, nullptr, nullptr)) {
            throw std::runtime_error("Could not set AppContainer launch attributes");
        }
        const auto result = run(program, L"--sandbox " + quote(privateFile.wstring()) + L" " + port,
                                workspace, startup, EXTENDED_STARTUPINFO_PRESENT);
        cleanup();
        return static_cast<int>(result);
    } catch (...) {
        cleanup();
        throw;
    }
}

int wmain(int argc, wchar_t** argv) {
    try {
        if (argc == 2 && std::wstring(argv[1]) == L"--child") return appContainerToken() ? 0 : 17;
        if (argc == 4 && std::wstring(argv[1]) == L"--sandbox") return sandboxProbe(argv[2], argv[3]);
        if (argc != 5) return 2;
        return launchSandbox(argv[0], argv[1], argv[2], argv[3], argv[4]);
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
