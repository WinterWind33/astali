// Copyright (C) 2022 Andrea Ballestrazzi

import 'package:flutter_test/flutter_test.dart';
import 'package:mockito/annotations.dart';
import 'package:astali/settings_menu_spawner.dart';
import 'package:astali/settings_button_event_handler.dart';
import 'package:mockito/mockito.dart';

// Test Doubles
import 'settings_menu_eh_test.mocks.dart';
import 'dummy_build_context.dart';

@GenerateMocks([SettingsMenuSpawner])
void main() {
  group("When onPressed() is called", () {
    final DummyBuildContext dummyBC = DummyBuildContext();
    final MockSettingsMenuSpawner mockSpawner = MockSettingsMenuSpawner();

    SettingsButtonEventHandler settingsButtonEH =
        SettingsButtonEventHandler(mockSpawner);

    test("Then the event handler should spawn the settings menu", () {
      // Exercise SUT
      settingsButtonEH.onPressed(dummyBC);

      verify(mockSpawner.spawnSettingsMenu(dummyBC)).called(1);
    });
  });
}
