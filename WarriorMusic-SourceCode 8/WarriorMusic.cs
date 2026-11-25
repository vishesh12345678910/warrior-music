using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("Warrior Music")]
[assembly: AssemblyProduct("Warrior Music")]
[assembly: AssemblyCompany("Vishesh")]
[assembly: AssemblyCopyright("Copyright (C) 2026 Vishesh")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

namespace WarriorMusicApp
{
    static class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            try
            {
                string appDir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
                EnsureServerRunning(appDir);
                LaunchAppWindow();
            }
            catch (Exception ex)
            {
                MessageBox.Show("Could not start Warrior Music: " + ex.Message, "Warrior Music", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        static bool IsServerAlive()
        {
            try
            {
                var req = (HttpWebRequest)WebRequest.Create("http://localhost:3000/api/bootstrap");
                req.Timeout = 1500;
                using (var res = (HttpWebResponse)req.GetResponse())
                {
                    return res.StatusCode == HttpStatusCode.OK;
                }
            }
            catch
            {
                return false;
            }
        }

        static void EnsureServerRunning(string appDir)
        {
            if (IsServerAlive()) return;

            string serverScript = Path.Combine(appDir, "server.js");
            if (!File.Exists(serverScript))
            {
                string devPath = @"C:\Users\Hp\.gemini\antigravity\scratch\novax-music-app\server.js";
                if (File.Exists(devPath)) serverScript = devPath;
            }

            if (File.Exists(serverScript))
            {
                var startInfo = new ProcessStartInfo
                {
                    FileName = "node.exe",
                    Arguments = "\"" + serverScript + "\"",
                    WorkingDirectory = Path.GetDirectoryName(serverScript),
                    CreateNoWindow = true,
                    WindowStyle = ProcessWindowStyle.Hidden,
                    UseShellExecute = false
                };
                Process.Start(startInfo);

                for (int i = 0; i < 20; i++)
                {
                    Thread.Sleep(250);
                    if (IsServerAlive()) break;
                }
            }
        }

        static void LaunchAppWindow()
        {
            string url = "http://localhost:3000";
            string[] browsers = new string[]
            {
                @"C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe",
                @"C:\Program Files\Google\Chrome\Application\chrome.exe",
                @"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
                @"C:\Program Files (x86)\Microsoft\EdgeWebView\Application\150.0.4078.83\msedge.exe"
            };

            string userDataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "WarriorMusic", "Profile");
            if (!Directory.Exists(userDataDir)) Directory.CreateDirectory(userDataDir);

            foreach (var b in browsers)
            {
                if (File.Exists(b))
                {
                    var startInfo = new ProcessStartInfo
                    {
                        FileName = b,
                        Arguments = "--app=\"" + url + "\" --app-id=warriormusic --user-data-dir=\"" + userDataDir + "\" --window-size=1280,820",
                        UseShellExecute = true
                    };
                    Process.Start(startInfo);
                    return;
                }
            }

            Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
        }
    }
}
