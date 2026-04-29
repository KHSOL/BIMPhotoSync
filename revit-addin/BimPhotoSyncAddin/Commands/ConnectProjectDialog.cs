using System.Windows;
using System.Windows.Controls;
using BimPhotoSyncAddin.Models;
using BimPhotoSyncAddin.Services;

namespace BimPhotoSyncAddin.Commands;

public sealed class ConnectProjectDialog : Window
{
    private readonly TextBox _apiBaseUrl = new() { MinWidth = 420 };
    private readonly TextBox _email = new() { MinWidth = 260 };
    private readonly PasswordBox _password = new() { MinWidth = 260 };
    private readonly TextBox _newProjectName = new() { MinWidth = 260 };
    private readonly ComboBox _projects = new() { MinWidth = 260, DisplayMemberPath = nameof(ProjectListItem.Name) };
    private readonly TextBlock _status = new() { TextWrapping = TextWrapping.Wrap };

    public bool IsConfigured { get; private set; }

    public ConnectProjectDialog(string modelName)
    {
        Title = "BIM Photo Sync - Connect Project";
        Width = 560;
        Height = 500;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;
        ResizeMode = ResizeMode.NoResize;

        _apiBaseUrl.Text = AddinSettings.ApiBaseUrl;
        _email.Text = Environment.GetEnvironmentVariable("BIM_PHOTO_SYNC_EMAIL") ?? "";
        _password.Password = Environment.GetEnvironmentVariable("BIM_PHOTO_SYNC_PASSWORD") ?? "";
        _newProjectName.Text = modelName;
        _status.Text = "로그인 후 프로젝트를 선택하세요. 새 프로젝트는 상위 관리자 계정에서만 생성됩니다.";

        var root = new StackPanel { Margin = new Thickness(18) };
        root.Children.Add(new TextBlock { Text = "Backend API URL" });
        root.Children.Add(_apiBaseUrl);
        root.Children.Add(Spacer());
        root.Children.Add(new TextBlock { Text = "Email" });
        root.Children.Add(_email);
        root.Children.Add(Spacer());
        root.Children.Add(new TextBlock { Text = "Password" });
        root.Children.Add(_password);
        root.Children.Add(Spacer());

        var login = new Button { Content = "Login / Refresh Projects", Height = 34 };
        login.Click += async (_, _) => await LoginAndLoadProjectsAsync();
        root.Children.Add(login);
        root.Children.Add(Spacer());

        root.Children.Add(new TextBlock { Text = "Project" });
        root.Children.Add(_projects);
        root.Children.Add(Spacer());

        root.Children.Add(new TextBlock { Text = "Create Project Name" });
        root.Children.Add(_newProjectName);
        var create = new Button { Content = "Create Project", Height = 34 };
        create.Click += async (_, _) => await CreateProjectAsync();
        root.Children.Add(create);
        root.Children.Add(Spacer());

        var actions = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right };
        var cancel = new Button { Content = "Cancel", Width = 90, Height = 34, Margin = new Thickness(0, 0, 8, 0) };
        cancel.Click += (_, _) => Close();
        var connect = new Button { Content = "Save + Connect", Width = 130, Height = 34 };
        connect.Click += (_, _) => SaveAndClose();
        actions.Children.Add(cancel);
        actions.Children.Add(connect);
        root.Children.Add(actions);
        root.Children.Add(Spacer());
        root.Children.Add(_status);

        Content = root;
    }

    private async Task LoginAndLoadProjectsAsync()
    {
        try
        {
            ApplyApiBaseUrl();
            AuthResponse? auth = await new ApiClient().LoginAsync(new LoginRequest(_email.Text.Trim(), _password.Password));
            if (auth == null) throw new InvalidOperationException("Login response was empty.");
            AddinSettings.JwtToken = auth.Data.Access_Token;
            AddinSettings.Save();
            await LoadProjectsAsync();
            _status.Text = $"{auth.Data.User.Name} 계정으로 로그인했습니다. 프로젝트를 선택하세요.";
        }
        catch (Exception ex)
        {
            _status.Text = ex.Message;
        }
    }

    private async Task LoadProjectsAsync()
    {
        ProjectListResponse? response = await new ApiClient().GetProjectsAsync();
        _projects.ItemsSource = response?.Data ?? Array.Empty<ProjectListItem>();
        if (!string.IsNullOrWhiteSpace(AddinSettings.ProjectId))
        {
            _projects.SelectedItem = (response?.Data ?? Array.Empty<ProjectListItem>())
                .FirstOrDefault(project => project.Id == AddinSettings.ProjectId);
        }
        if (_projects.SelectedItem == null && _projects.Items.Count > 0)
        {
            _projects.SelectedIndex = 0;
        }
    }

    private async Task CreateProjectAsync()
    {
        try
        {
            ApplyApiBaseUrl();
            if (string.IsNullOrWhiteSpace(AddinSettings.JwtToken))
            {
                await LoginAndLoadProjectsAsync();
            }
            string name = _newProjectName.Text.Trim();
            if (string.IsNullOrWhiteSpace(name)) throw new InvalidOperationException("Project name is required.");
            ProjectListItem? project = await new ApiClient().CreateProjectAsync(new CreateProjectRequest(name, Slug(name)));
            await LoadProjectsAsync();
            if (project != null)
            {
                _projects.SelectedItem = ((IEnumerable<ProjectListItem>)_projects.ItemsSource)
                    .FirstOrDefault(item => item.Id == project.Id);
            }
            _status.Text = $"{name} 프로젝트를 생성했습니다.";
        }
        catch (Exception ex)
        {
            _status.Text = ex.Message;
        }
    }

    private void SaveAndClose()
    {
        ApplyApiBaseUrl();
        if (_projects.SelectedItem is not ProjectListItem project)
        {
            _status.Text = "프로젝트를 선택하세요.";
            return;
        }
        AddinSettings.ProjectId = project.Id;
        AddinSettings.Save();
        IsConfigured = true;
        DialogResult = true;
        Close();
    }

    private void ApplyApiBaseUrl()
    {
        string url = _apiBaseUrl.Text.Trim().TrimEnd('/');
        if (string.IsNullOrWhiteSpace(url)) throw new InvalidOperationException("Backend API URL is required.");
        AddinSettings.ApiBaseUrl = url;
    }

    private static UIElement Spacer() => new Border { Height = 10 };

    private static string Slug(string value)
    {
        string slug = new string(value.ToLowerInvariant().Select(ch => char.IsLetterOrDigit(ch) ? ch : '-').ToArray());
        while (slug.Contains("--", StringComparison.Ordinal)) slug = slug.Replace("--", "-", StringComparison.Ordinal);
        slug = slug.Trim('-');
        return string.IsNullOrWhiteSpace(slug) ? $"revit-{DateTimeOffset.UtcNow.ToUnixTimeSeconds()}" : slug;
    }
}
