import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DataManager } from './data-manager';

describe('DataManager', () => {
  let component: DataManager;
  let fixture: ComponentFixture<DataManager>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DataManager],
    }).compileComponents();

    fixture = TestBed.createComponent(DataManager);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
