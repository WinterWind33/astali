// Copyright (C) 2022 Andrea Ballestrazzi

import 'package:astali/settings/settings_menu_spawner.dart';
import 'package:flutter/material.dart';

class SettingsButtonEventHandler {
  const SettingsButtonEventHandler(SettingsMenuSpawner spawner)
      : menuSpawner = spawner;

  void onPressed(BuildContext context) {
    menuSpawner.spawnSettingsMenu(context);
  }

  final SettingsMenuSpawner menuSpawner;
}
