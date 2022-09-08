// Copyright (C) 2022 Andrea Ballestrazzi

import 'default_settings_menu_spawner.dart';

class DefaultSettingsMenuEventHandlerImpl
    implements DefaultSettingsMenuEventHandler {
  const DefaultSettingsMenuEventHandlerImpl();

  @override
  void onAboutSelected() {
    print("About selected.");
  }
}
