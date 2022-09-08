// Copyright (C) 2022 Andrea Ballestrazzi

import 'astali_injector.dart';

// Settings
import 'settings/settings_menu_spawner.dart';
import 'settings/default_settings_menu_spawner.dart';
import 'settings/default_settings_menu_event_handler.dart';

/// Represents the injector used inside the astali entry point.
class AstaliMainInjector implements AstaliInjector {
  const AstaliMainInjector();

  @override
  SettingsMenuSpawner getSettingsMenuSpawner() {
    return DefaultSettingsMenuSpawner(
        const DefaultSettingsMenuEventHandlerImpl());
  }
}
