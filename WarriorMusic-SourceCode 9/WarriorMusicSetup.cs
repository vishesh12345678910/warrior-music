using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("Warrior Music Setup")]
[assembly: AssemblyProduct("Warrior Music")]
[assembly: AssemblyCompany("Vishesh")]
[assembly: AssemblyCopyright("Copyright (C) 2026 Vishesh")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

namespace WarriorMusicInstaller
{
    public class SetupForm : Form
    {
        private ProgressBar progressBar;
        private Label lblStatus;
        private Label lblTitle;
        private Label lblSubtitle;
        private CheckBox chkDesktop;
        private CheckBox chkLaunch;
        private Button btnAction;
        private PictureBox picIcon;
        private bool isFinished = false;

        public SetupForm()
        {
            InitializeComponent();
        }

        private void InitializeComponent()
        {
            this.Text = "Warrior Music Setup";
            this.Size = new Size(520, 360);
            this.FormBorderStyle = FormBorderStyle.FixedDialog;
            this.MaximizeBox = false;
            this.StartPosition = FormStartPosition.CenterScreen;
            this.BackColor = Color.FromArgb(20, 20, 24);
            this.ForeColor = Color.White;

            picIcon = new PictureBox();
            picIcon.Size = new Size(54, 54);
            picIcon.Location = new Point(28, 24);
            picIcon.SizeMode = PictureBoxSizeMode.Zoom;

            try
            {
                using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("app_logo.png"))
                {
                    if (s != null) picIcon.Image = Image.FromStream(s);
                }
            }
            catch { }

            try
            {
                using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("app_icon.ico"))
                {
                    if (s != null) this.Icon = new Icon(s);
                }
            }
            catch { }

            this.Controls.Add(picIcon);

            lblTitle = new Label();
            lblTitle.Text = "Warrior Music Setup";
            lblTitle.Font = new Font("Segoe UI", 16, FontStyle.Bold);
            lblTitle.Location = new Point(96, 24);
            lblTitle.Size = new Size(380, 32);
            this.Controls.Add(lblTitle);

            lblSubtitle = new Label();
            lblSubtitle.Text = "Install Warrior Music on your computer for ad-free music.";
            lblSubtitle.Font = new Font("Segoe UI", 9.5f, FontStyle.Regular);
            lblSubtitle.ForeColor = Color.FromArgb(170, 170, 180);
            lblSubtitle.Location = new Point(98, 56);
            lblSubtitle.Size = new Size(380, 24);
            this.Controls.Add(lblSubtitle);

            var panelLine = new Panel();
            panelLine.BackColor = Color.FromArgb(40, 40, 48);
            panelLine.Location = new Point(28, 92);
            panelLine.Size = new Size(450, 1);
            this.Controls.Add(panelLine);

            lblStatus = new Label();
            lblStatus.Text = "Ready to install to your PC.";
            lblStatus.Font = new Font("Segoe UI", 9f);
            lblStatus.ForeColor = Color.FromArgb(220, 220, 230);
            lblStatus.Location = new Point(28, 114);
            lblStatus.Size = new Size(450, 22);
            this.Controls.Add(lblStatus);

            progressBar = new ProgressBar();
            progressBar.Location = new Point(28, 140);
            progressBar.Size = new Size(450, 18);
            progressBar.Style = ProgressBarStyle.Continuous;
            this.Controls.Add(progressBar);

            chkDesktop = new CheckBox();
            chkDesktop.Text = "Create a Desktop shortcut for Warrior Music";
            chkDesktop.Font = new Font("Segoe UI", 9f);
            chkDesktop.Location = new Point(32, 178);
            chkDesktop.Size = new Size(440, 24);
            chkDesktop.Checked = true;
            this.Controls.Add(chkDesktop);

            chkLaunch = new CheckBox();
            chkLaunch.Text = "Launch Warrior Music when installation completes";
            chkLaunch.Font = new Font("Segoe UI", 9f);
            chkLaunch.Location = new Point(32, 206);
            chkLaunch.Size = new Size(440, 24);
            chkLaunch.Checked = true;
            this.Controls.Add(chkLaunch);

            btnAction = new Button();
            btnAction.Text = "Install";
            btnAction.Font = new Font("Segoe UI", 10f, FontStyle.Bold);
            btnAction.BackColor = Color.FromArgb(255, 122, 0);
            btnAction.ForeColor = Color.Black;
            btnAction.FlatStyle = FlatStyle.Flat;
            btnAction.FlatAppearance.BorderSize = 0;
            btnAction.Location = new Point(358, 256);
            btnAction.Size = new Size(120, 38);
            btnAction.Cursor = Cursors.Hand;
            btnAction.Click += BtnAction_Click;
            this.Controls.Add(btnAction);
        }

        private void BtnAction_Click(object sender, EventArgs e)
        {
            if (isFinished)
            {
                if (chkLaunch.Checked)
                {
                    string targetDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "WarriorMusic");
                    string exe = Path.Combine(targetDir, "WarriorMusic.exe");
                    if (File.Exists(exe)) Process.Start(exe);
                }
                this.Close();
                return;
            }

            btnAction.Enabled = false;
            ThreadPool.QueueUserWorkItem(InstallWorker);
        }

        private void InstallWorker(object state)
        {
            try
            {
                UpdateProgress(10, "Preparing installation folder...");
                string targetDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "WarriorMusic");
                if (!Directory.Exists(targetDir)) Directory.CreateDirectory(targetDir);

                UpdateProgress(25, "Extracting Warrior Music core files...");
                string tempZip = Path.Combine(Path.GetTempPath(), "warrior_music_setup_" + Guid.NewGuid().ToString("N") + ".zip");
                
                using (Stream resStream = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip"))
                {
                    if (resStream == null) throw new Exception("Setup archive is missing from installer.");
                    using (FileStream fs = new FileStream(tempZip, FileMode.Create, FileAccess.Write))
                    {
                        byte[] buffer = new byte[81920];
                        int read;
                        while ((read = resStream.Read(buffer, 0, buffer.Length)) > 0)
                        {
                            fs.Write(buffer, 0, read);
                        }
                    }
                }

                UpdateProgress(50, "Installing files to " + targetDir + "...");
                using (ZipArchive archive = ZipFile.OpenRead(tempZip))
                {
                    foreach (ZipArchiveEntry entry in archive.Entries)
                    {
                        string fullPath = Path.Combine(targetDir, entry.FullName);
                        if (string.IsNullOrEmpty(entry.Name))
                        {
                            Directory.CreateDirectory(fullPath);
                        }
                        else
                        {
                            string dir = Path.GetDirectoryName(fullPath);
                            if (!Directory.Exists(dir)) Directory.CreateDirectory(dir);
                            entry.ExtractToFile(fullPath, true);
                        }
                    }
                }
                try { File.Delete(tempZip); } catch { }

                UpdateProgress(75, "Creating shortcuts...");
                string exePath = Path.Combine(targetDir, "WarriorMusic.exe");
                string iconPath = Path.Combine(targetDir, "public", "assets", "logo.ico");
                if (!File.Exists(iconPath)) iconPath = exePath;

                if (chkDesktop.Checked)
                {
                    string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                    CreateShortcut(Path.Combine(desktop, "Warrior Music.lnk"), exePath, targetDir, iconPath);
                }

                string startMenu = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.StartMenu), "Programs");
                CreateShortcut(Path.Combine(startMenu, "Warrior Music.lnk"), exePath, targetDir, iconPath);

                UpdateProgress(90, "Registering Warrior Music in Windows...");
                RegisterUninstall(targetDir, exePath, iconPath);

                UpdateProgress(100, "Warrior Music has been successfully installed!");
                this.Invoke((MethodInvoker)delegate
                {
                    isFinished = true;
                    btnAction.Text = "Finish";
                    btnAction.Enabled = true;
                });
            }
            catch (Exception ex)
            {
                this.Invoke((MethodInvoker)delegate
                {
                    MessageBox.Show("Installation error: " + ex.Message, "Warrior Music Setup", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    btnAction.Enabled = true;
                });
            }
        }

        private void UpdateProgress(int percent, string status)
        {
            if (this.InvokeRequired)
            {
                this.Invoke((MethodInvoker)delegate { UpdateProgress(percent, status); });
                return;
            }
            progressBar.Value = Math.Min(100, Math.Max(0, percent));
            lblStatus.Text = status;
        }

        private void CreateShortcut(string shortcutPath, string targetExe, string workDir, string icon)
        {
            try
            {
                Type shellType = Type.GetTypeFromProgID("WScript.Shell");
                dynamic shell = Activator.CreateInstance(shellType);
                dynamic shortcut = shell.CreateShortcut(shortcutPath);
                shortcut.TargetPath = targetExe;
                shortcut.WorkingDirectory = workDir;
                shortcut.IconLocation = icon + ",0";
                shortcut.Description = "Warrior Music - Ad-Free Music Player";
                shortcut.Save();
            }
            catch { }
        }

        private void RegisterUninstall(string appDir, string exePath, string iconPath)
        {
            try
            {
                using (RegistryKey key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\WarriorMusic"))
                {
                    if (key != null)
                    {
                        key.SetValue("DisplayName", "Warrior Music");
                        key.SetValue("DisplayIcon", iconPath);
                        key.SetValue("DisplayVersion", "1.0.0");
                        key.SetValue("Publisher", "Vishesh (__VISHESH__)");
                        key.SetValue("InstallLocation", appDir);
                        key.SetValue("UninstallString", "cmd.exe /c rd /s /q \"" + appDir + "\"");
                    }
                }
            }
            catch { }
        }

        [STAThread]
        static void Main()
        {
            try
            {
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new SetupForm());
            }
            catch (Exception ex)
            {
                MessageBox.Show("Warrior Music Setup error: " + ex.Message, "Warrior Music Setup", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }
    }
}
