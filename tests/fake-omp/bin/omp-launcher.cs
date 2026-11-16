// 가짜 omp.exe 래퍼: 같은 트리의 fake-omp.js 를 node 로 실행하고 표준 입출력을 파이프로 이어 준다.
// 맵은 spawn("omp") 로 .cmd 를 찾지 못하므로(CreateProcess 는 .exe 만 붙인다) csc 로 컴파일해 쓴다.
using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading.Tasks;

static class OmpLauncher
{
    static string Quote(string s)
    {
        if (s.Length > 0 && s.IndexOfAny(new[] { ' ', '\t', '"' }) < 0) return s;
        var b = new StringBuilder("\"");
        int n = 0;
        foreach (char c in s)
        {
            if (c == '\\') { b.Append(c); n++; }
            else if (c == '"') { b.Append('\\', n * 2 + 1).Append('"'); n = 0; }
            else { b.Append(c); n = 0; }
        }
        b.Append('\\', n * 2).Append('"');
        return b.ToString();
    }

    // 한 스트림을 다른 스트림으로 바이트 그대로 옮긴다. 한쪽이 닫히면 조용히 끝난다.
    static void Pump(Stream from, Stream to)
    {
        var buf = new byte[8192];
        try
        {
            int n;
            while ((n = from.Read(buf, 0, buf.Length)) > 0)
            {
                to.Write(buf, 0, n);
                to.Flush();
            }
        }
        catch { }
        finally
        {
            try { to.Flush(); } catch { }
        }
    }

    static int Main(string[] args)
    {
        string dir = AppDomain.CurrentDomain.BaseDirectory;
        string script = Path.GetFullPath(Path.Combine(dir, "..", "fake-omp.js"));
        var cmd = new StringBuilder(Quote(script));
        foreach (string a in args) cmd.Append(' ').Append(Quote(a));

        var psi = new ProcessStartInfo(Environment.GetEnvironmentVariable("FAKE_OMP_NODE") ?? "node", cmd.ToString());
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.RedirectStandardInput = true;
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        try
        {
            var p = Process.Start(psi);
            var stdout = Task.Run(() => Pump(p.StandardOutput.BaseStream, Console.OpenStandardOutput()));
            var stderr = Task.Run(() => Pump(p.StandardError.BaseStream, Console.OpenStandardError()));
            var stdin = Task.Run(() =>
            {
                Pump(Console.OpenStandardInput(), p.StandardInput.BaseStream);
                try { p.StandardInput.Close(); } catch { }
            });
            p.WaitForExit();
            Task.WaitAll(new[] { stdout, stderr }, 2000);
            return p.ExitCode;
        }
        catch (Exception e)
        {
            Console.Error.WriteLine("fake-omp launcher: " + e.Message);
            return 127;
        }
    }
}
